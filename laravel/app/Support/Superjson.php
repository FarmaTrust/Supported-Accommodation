<?php
declare(strict_types=1);

namespace App\Support;

/**
 * The React client talks to this API through tRPC's httpBatchLink with the
 * superjson transformer, so every payload on the wire is {json, meta} rather
 * than plain JSON. superjson keeps the JSON tree free of type information and
 * records the awkward values separately in meta.values, keyed by a dotted path
 * from the root ("." is the root itself).
 *
 * Only the types this API actually exchanges are handled: dates, which every
 * timestamp column produces, plus the undefined/NaN/Infinity cases that fall
 * out of PHP floats. Sets, Maps, BigInt and RegExp are not implemented because
 * no procedure returns them; encode() throws instead of silently shipping a
 * value the client would decode as something else.
 */
final class Superjson
{
    /** @return array{json: mixed, meta?: array{values: array<string, array<int, string>>}} */
    public static function encode(mixed $value): array
    {
        $meta = [];
        $json = self::walkEncode($value, '.', $meta);

        return $meta === [] ? ['json' => $json] : ['json' => $json, 'meta' => ['values' => $meta]];
    }

    /** @param array<string, array<int, string>> $meta */
    private static function walkEncode(mixed $value, string $path, array &$meta): mixed
    {
        if ($value instanceof \DateTimeInterface) {
            $meta[$path] = ['Date'];
            // superjson uses the ISO-8601 form Date#toJSON produces: always UTC,
            // always milliseconds.
            return $value->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.v\Z');
        }

        if (is_float($value)) {
            if (is_nan($value)) {
                $meta[$path] = ['number'];
                return 'NaN';
            }
            if (is_infinite($value)) {
                $meta[$path] = ['number'];
                return $value > 0 ? 'Infinity' : '-Infinity';
            }
            return $value;
        }

        if (is_array($value)) {
            $out = [];
            foreach ($value as $key => $item) {
                $childPath = $path === '.' ? (string) $key : $path . '.' . $key;
                $out[$key] = self::walkEncode($item, $childPath, $meta);
            }
            return $out;
        }

        if ($value instanceof \JsonSerializable) {
            return self::walkEncode($value->jsonSerialize(), $path, $meta);
        }

        if (is_object($value)) {
            throw new \InvalidArgumentException(
                'Superjson cannot encode ' . $value::class . ' at path "' . $path . '". Convert it to an array, a scalar or a DateTimeInterface first.'
            );
        }

        return $value;
    }

    /** Reverse of encode(): applies meta.values back onto the decoded json tree. */
    public static function decode(mixed $payload): mixed
    {
        if (!is_array($payload) || !array_key_exists('json', $payload)) {
            // A client that sends a bare value rather than a superjson envelope
            // still has to be understood, because tRPC omits the envelope for
            // procedures called without input.
            return $payload;
        }

        $json = $payload['json'];
        $values = $payload['meta']['values'] ?? null;
        if (!is_array($values)) {
            return $json;
        }

        foreach ($values as $path => $annotation) {
            $type = is_array($annotation) ? ($annotation[0] ?? null) : $annotation;
            $json = self::applyAnnotation($json, self::splitPath((string) $path), (string) $type);
        }

        return $json;
    }

    /** @return array<int, string> */
    private static function splitPath(string $path): array
    {
        return $path === '.' ? [] : explode('.', $path);
    }

    /** @param array<int, string> $segments */
    private static function applyAnnotation(mixed $node, array $segments, string $type): mixed
    {
        if ($segments === []) {
            return self::revive($node, $type);
        }

        $head = array_shift($segments);
        if (!is_array($node) || !array_key_exists($head, $node)) {
            // A path that does not exist in the tree is ignored rather than
            // treated as an error: a malformed request must not become a 500.
            return $node;
        }

        $node[$head] = self::applyAnnotation($node[$head], $segments, $type);
        return $node;
    }

    private static function revive(mixed $node, string $type): mixed
    {
        return match ($type) {
            'Date' => is_string($node) ? new \DateTimeImmutable($node) : $node,
            'undefined' => null,
            'number' => match ($node) {
                'NaN' => NAN,
                'Infinity' => INF,
                '-Infinity' => -INF,
                default => $node,
            },
            default => $node,
        };
    }
}
