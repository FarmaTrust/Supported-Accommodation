<?php

declare(strict_types=1);

namespace App\Trpc;

use DateTimeInterface;

/**
 * Input checking for tRPC procedures, standing in for the zod schemas on the
 * Node side.
 *
 * Laravel's Validator is built around an HTTP form: an array of fields, a bag of
 * messages and a 422. These procedures take a single decoded superjson value and
 * must answer with a tRPC BAD_REQUEST carrying one message, so the rules are
 * expressed directly here instead. Every failure names the field, because the
 * client shows the message as-is.
 *
 * Each rule rejects rather than coerces. A procedure that silently accepted the
 * string "5" where it wanted a row id would write the wrong row rather than
 * refuse.
 */
final class Validate
{
    /** @param array<string, mixed>|null $input */
    public static function field(mixed $input, string $key): mixed
    {
        return is_array($input) ? ($input[$key] ?? null) : null;
    }

    public static function email(mixed $value, string $field = 'email'): string
    {
        if (!is_string($value)) {
            throw TrpcException::badRequest('Enter an email address.');
        }

        $email = trim($value);
        if ($email === '' || strlen($email) > 320 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            throw TrpcException::badRequest('Enter a valid email address.');
        }

        return $email;
    }

    public static function password(mixed $value, string $field = 'password'): string
    {
        if (!is_string($value) || $value === '' || strlen($value) > 256) {
            throw TrpcException::badRequest('Enter your password.');
        }

        return $value;
    }

    public static function token(mixed $value, string $message, int $min = 32, int $max = 512): string
    {
        if (!is_string($value) || strlen($value) < $min || strlen($value) > $max) {
            throw TrpcException::badRequest($message);
        }

        return $value;
    }

    public static function phone(mixed $value, string $field = 'phone'): string
    {
        if (!is_string($value)) {
            throw TrpcException::badRequest('Enter a phone number.');
        }

        $compact = preg_replace('/[\s().-]/', '', trim($value)) ?? '';
        if (preg_match('/^\+?[0-9]{7,20}$/', $compact) !== 1) {
            throw TrpcException::badRequest(
                'Enter a valid phone number using 7 to 20 digits, with an optional leading + country code.'
            );
        }

        return $compact;
    }

    public static function string(mixed $value, string $field, int $min = 1, int $max = 1000, bool $trim = true): string
    {
        if (!is_string($value)) {
            throw TrpcException::badRequest(self::label($field) . ' is required.');
        }

        $text = $trim ? trim($value) : $value;
        if (strlen($text) < $min) {
            throw $min === 1
                ? TrpcException::badRequest(self::label($field) . ' is required.')
                : TrpcException::badRequest(self::label($field) . " must be at least $min characters.");
        }
        if (strlen($text) > $max) {
            throw TrpcException::badRequest(self::label($field) . " must be no more than $max characters.");
        }

        return $text;
    }

    public static function optionalString(mixed $value, string $field, int $max = 1000): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        return self::string($value, $field, 1, $max);
    }

    public static function int(mixed $value, string $field, ?int $min = null, ?int $max = null): int
    {
        // A numeric string is refused rather than cast: the client sends real
        // numbers through superjson, so a string here means the caller sent
        // something else.
        if (!is_int($value) && !(is_float($value) && floor($value) === $value)) {
            throw TrpcException::badRequest(self::label($field) . ' must be a number.');
        }

        $number = (int) $value;
        if ($min !== null && $number < $min) {
            throw TrpcException::badRequest(self::label($field) . " must be at least $min.");
        }
        if ($max !== null && $number > $max) {
            throw TrpcException::badRequest(self::label($field) . " must be no more than $max.");
        }

        return $number;
    }

    public static function optionalInt(mixed $value, string $field, ?int $min = null, ?int $max = null): ?int
    {
        return $value === null ? null : self::int($value, $field, $min, $max);
    }

    /** A row id: a positive integer. */
    public static function id(mixed $value, string $field = 'id'): int
    {
        return self::int($value, $field, 1);
    }

    public static function optionalId(mixed $value, string $field = 'id'): ?int
    {
        return $value === null ? null : self::id($value, $field);
    }

    public static function bool(mixed $value, string $field, bool $default = false): bool
    {
        if ($value === null) {
            return $default;
        }
        if (!is_bool($value)) {
            throw TrpcException::badRequest(self::label($field) . ' must be true or false.');
        }

        return $value;
    }

    public static function decimal(mixed $value, string $field, ?float $min = null, ?float $max = null): float
    {
        if (!is_int($value) && !is_float($value)) {
            throw TrpcException::badRequest(self::label($field) . ' must be a number.');
        }

        $number = (float) $value;
        if (is_nan($number) || is_infinite($number)) {
            throw TrpcException::badRequest(self::label($field) . ' must be a number.');
        }
        if ($min !== null && $number < $min) {
            throw TrpcException::badRequest(self::label($field) . " must be at least $min.");
        }
        if ($max !== null && $number > $max) {
            throw TrpcException::badRequest(self::label($field) . " must be no more than $max.");
        }

        return $number;
    }

    /**
     * @param array<int, string> $allowed
     */
    public static function enum(mixed $value, array $allowed, string $field): string
    {
        if (!is_string($value) || !in_array($value, $allowed, true)) {
            throw TrpcException::badRequest(
                self::label($field) . ' must be one of: ' . implode(', ', $allowed) . '.'
            );
        }

        return $value;
    }

    /**
     * @param array<int, string> $allowed
     */
    public static function optionalEnum(mixed $value, array $allowed, string $field): ?string
    {
        return $value === null ? null : self::enum($value, $allowed, $field);
    }

    /**
     * Dates arrive as DateTimeInterface, because superjson revives them before
     * the procedure sees them.
     */
    public static function date(mixed $value, string $field): DateTimeInterface
    {
        if (!$value instanceof DateTimeInterface) {
            throw TrpcException::badRequest(self::label($field) . ' must be a date.');
        }

        return $value;
    }

    public static function optionalDate(mixed $value, string $field): ?DateTimeInterface
    {
        return $value === null ? null : self::date($value, $field);
    }

    /**
     * @return array<int, mixed>
     */
    public static function arrayOf(mixed $value, string $field, int $max = 500): array
    {
        if (!is_array($value)) {
            throw TrpcException::badRequest(self::label($field) . ' must be a list.');
        }
        if (count($value) > $max) {
            throw TrpcException::badRequest(self::label($field) . " may hold no more than $max entries.");
        }

        return array_values($value);
    }

    /**
     * @return array<string, mixed>
     */
    public static function object(mixed $value, string $field): array
    {
        if (!is_array($value)) {
            throw TrpcException::badRequest(self::label($field) . ' must be an object.');
        }

        return $value;
    }

    /** "targetUserId" reads back to the person as "Target user id". */
    private static function label(string $field): string
    {
        $spaced = trim(preg_replace('/(?<!^)[A-Z]/', ' $0', $field) ?? $field);

        return ucfirst(strtolower($spaced));
    }
}
