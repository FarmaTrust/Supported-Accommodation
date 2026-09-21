<?php

declare(strict_types=1);

namespace App\Support;

use RuntimeException;

/**
 * Field-level encryption for the few columns that hold bank details, mirroring
 * server/services/crypto.ts.
 *
 * AES-256-GCM with a key derived from the server secret, stored as
 * base64url(iv).base64url(tag).base64url(ciphertext). The format and the key
 * derivation match the Node implementation exactly, so a value written by
 * either runtime can be read by the other — without that, sort codes already in
 * the database would become unreadable the moment traffic moved across.
 *
 * GCM is authenticated: a tampered ciphertext fails to decrypt rather than
 * returning altered plaintext.
 */
final class Crypto
{
    private static function key(): string
    {
        $secret = (string) env('JWT_SECRET', '');
        if ($secret === '') {
            throw new RuntimeException('Server encryption secret is unavailable');
        }

        return hash('sha256', "supported-accommodation:$secret", true);
    }

    public static function encrypt(string $value): string
    {
        $iv = random_bytes(12);
        $tag = '';

        $encrypted = openssl_encrypt($value, 'aes-256-gcm', self::key(), OPENSSL_RAW_DATA, $iv, $tag);
        if ($encrypted === false) {
            throw new RuntimeException('Unable to encrypt value');
        }

        return implode('.', array_map(
            static fn (string $part): string => Jwt::base64UrlEncode($part),
            [$iv, $tag, $encrypted],
        ));
    }

    public static function decrypt(?string $payload): ?string
    {
        if ($payload === null || $payload === '') {
            return null;
        }

        $parts = explode('.', $payload);
        if (count($parts) !== 3 || in_array('', $parts, true)) {
            throw new RuntimeException('Invalid encrypted payload');
        }

        [$iv, $tag, $encrypted] = array_map(
            static fn (string $part): string => Jwt::base64UrlDecode($part),
            $parts,
        );

        $plaintext = openssl_decrypt($encrypted, 'aes-256-gcm', self::key(), OPENSSL_RAW_DATA, $iv, $tag);

        // A false here means the authentication tag did not match, so the
        // ciphertext was altered or the key is wrong. Either way there is no
        // plaintext to return.
        if ($plaintext === false) {
            throw new RuntimeException('Unable to decrypt value');
        }

        return $plaintext;
    }

    /**
     * Sort codes and account numbers are shown as a masked hint rather than in
     * full, so a screen or an export never carries the whole number.
     */
    public static function maskTail(?string $payload, int $visible = 4): ?string
    {
        $value = self::decrypt($payload);
        if ($value === null) {
            return null;
        }

        $length = strlen($value);
        if ($length <= $visible) {
            return str_repeat('•', $length);
        }

        return str_repeat('•', $length - $visible) . substr($value, -$visible);
    }
}
