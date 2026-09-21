<?php
declare(strict_types=1);

namespace Hub;

/**
 * HS256 JSON Web Tokens, matching the tokens the Node server issues with jose
 * so a session cookie minted by either runtime is accepted by the other.
 *
 * Written against hash_hmac rather than a JWT library: the Node side only ever
 * signs HS256 with a single shared secret, and a dependency that has to be
 * installed with composer on shared hosting is more to go wrong than the
 * twenty lines it would save.
 */
final class Jwt
{
    /** @param array<string, mixed> $claims */
    public static function sign(array $claims, string $secret, int $expiresAt): string
    {
        $header = self::base64UrlEncode(self::jsonEncode(['alg' => 'HS256', 'typ' => 'JWT']));
        $claims['exp'] = $expiresAt;
        $payload = self::base64UrlEncode(self::jsonEncode($claims));
        $signature = self::base64UrlEncode(hash_hmac('sha256', $header . '.' . $payload, $secret, true));

        return $header . '.' . $payload . '.' . $signature;
    }

    /**
     * Returns the claims, or null for any token that is malformed, not HS256,
     * badly signed or expired. Callers cannot tell those cases apart on
     * purpose: the difference is useful to an attacker and to nobody else.
     *
     * @return array<string, mixed>|null
     */
    public static function verify(?string $token, string $secret): ?array
    {
        if ($token === null || $token === '') {
            return null;
        }

        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            return null;
        }
        [$header64, $payload64, $signature64] = $parts;

        $header = self::jsonDecode(self::base64UrlDecode($header64));
        if (!is_array($header) || ($header['alg'] ?? null) !== 'HS256') {
            // Refusing anything but HS256 here is what stops the "alg": "none"
            // and RS256-confusion attacks.
            return null;
        }

        $expected = hash_hmac('sha256', $header64 . '.' . $payload64, $secret, true);
        if (!hash_equals($expected, self::base64UrlDecode($signature64))) {
            return null;
        }

        $claims = self::jsonDecode(self::base64UrlDecode($payload64));
        if (!is_array($claims)) {
            return null;
        }

        $exp = $claims['exp'] ?? null;
        if (is_numeric($exp) && time() >= (int) $exp) {
            return null;
        }

        return $claims;
    }

    public static function base64UrlEncode(string $raw): string
    {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    public static function base64UrlDecode(string $encoded): string
    {
        $padded = strtr($encoded, '-_', '+/');
        $remainder = strlen($padded) % 4;
        if ($remainder !== 0) {
            $padded .= str_repeat('=', 4 - $remainder);
        }

        return (string) base64_decode($padded, true);
    }

    /** @param array<string, mixed> $value */
    private static function jsonEncode(array $value): string
    {
        return (string) json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }

    private static function jsonDecode(string $raw): mixed
    {
        try {
            return json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return null;
        }
    }
}
