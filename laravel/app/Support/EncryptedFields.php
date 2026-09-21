<?php

declare(strict_types=1);

namespace App\Support;

/**
 * Reveals the encrypted columns on a row for the client.
 *
 * Much of the staff workspace is stored encrypted at field level: a visitor's
 * name, what was discussed in a keywork session, the summary of a safeguarding
 * concern. Every one is a "…Ciphertext" column, and every procedure that
 * returns such a row has to decrypt the ones it is allowed to show and remove
 * the raw ciphertext.
 *
 * Doing that by hand per procedure is how a ciphertext column ends up shipped
 * to the browser by accident, so it is done here: name the fields, and the
 * plaintext appears under the plain name while every ciphertext column is
 * dropped — including any the caller did not name, which is the part that makes
 * a forgotten field fail closed rather than leak.
 */
final class EncryptedFields
{
    /**
     * @param array<string, mixed> $row
     * @param array<int, string> $fields plain names, for example "summary" for summaryCiphertext
     * @return array<string, mixed>
     */
    public static function reveal(array $row, array $fields): array
    {
        foreach ($fields as $field) {
            $column = $field . 'Ciphertext';
            $row[$field] = array_key_exists($column, $row) ? self::safeDecrypt($row[$column]) : null;
        }

        return self::strip($row);
    }

    /**
     * Drops every ciphertext column, whether or not it was decrypted. A field
     * the caller did not ask for is withheld rather than returned raw.
     *
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    public static function strip(array $row): array
    {
        foreach (array_keys($row) as $key) {
            if (str_ends_with((string) $key, 'Ciphertext')) {
                unset($row[$key]);
            }
        }

        return $row;
    }

    /**
     * @param array<int, array<string, mixed>|object> $rows
     * @param array<int, string> $fields
     * @return array<int, array<string, mixed>>
     */
    public static function revealAll(iterable $rows, array $fields): array
    {
        $out = [];
        foreach ($rows as $row) {
            $out[] = self::reveal((array) $row, $fields);
        }

        return $out;
    }

    /** Encrypts a value, or returns null so an empty field stays empty. */
    public static function seal(?string $value): ?string
    {
        return $value === null || $value === '' ? null : Crypto::encrypt($value);
    }

    /**
     * A column that cannot be decrypted returns null rather than failing the
     * whole request: one unreadable note must not take a shift handover offline.
     * The reason is logged so it is not lost.
     *
     * error_log rather than report(): this runs on a defensive path that has to
     * work whether or not the framework is booted, and a failure to log must not
     * become the thing that breaks the request.
     */
    private static function safeDecrypt(mixed $value): ?string
    {
        if (!is_string($value) || $value === '') {
            return null;
        }

        try {
            return Crypto::decrypt($value);
        } catch (\Throwable $error) {
            error_log('[encrypted-fields] unreadable column: ' . $error->getMessage());

            return null;
        }
    }
}
