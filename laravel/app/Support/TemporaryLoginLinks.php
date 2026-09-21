<?php

declare(strict_types=1);

namespace App\Support;

use App\Trpc\TrpcException;

/**
 * One-time sign-in links, mirroring server/services/temporaryLoginLinks.ts.
 *
 * A link here starts a session as an existing account — it is the strongest
 * thing this system hands out. So it is single use, bounded in days rather than
 * open-ended, stored only as a hash, and it never creates an account or widens
 * one: everything it can reach, the account could already reach.
 */
final class TemporaryLoginLinks
{
    private const DAY_MS = 86400000;

    public const MIN_DAYS = 1;
    public const MAX_DAYS = 30;

    /** An opaque 256-bit token. Only its SHA-256 hash is ever persisted. */
    public static function createToken(): string
    {
        return Jwt::base64UrlEncode(random_bytes(32));
    }

    /** A bounded expiry off the server's own clock, never the caller's. */
    public static function expiresAt(int $expiresInDays, ?int $nowMs = null): int
    {
        if ($expiresInDays < self::MIN_DAYS || $expiresInDays > self::MAX_DAYS) {
            throw TrpcException::badRequest(sprintf(
                'Temporary sign-in links must expire between %d and %d days.',
                self::MIN_DAYS, self::MAX_DAYS,
            ));
        }

        return ($nowMs ?? Dates::nowMillis()) + $expiresInDays * self::DAY_MS;
    }

    /** True only while an unredeemed link may still start a session. */
    public static function isUsable(object $link, ?int $nowMs = null): bool
    {
        return $link->revokedAt === null
            && $link->redeemedAt === null
            && (int) $link->expiresAt > ($nowMs ?? Dates::nowMillis());
    }

    /**
     * Why a link did not work. This is for the audit trail only: the caller is
     * always told the same thing, so the endpoint cannot be used to find out
     * which links exist or what state they are in.
     */
    public static function unavailableReason(?object $link, ?int $nowMs = null): string
    {
        if ($link === null) {
            return 'invalid';
        }
        if ($link->revokedAt !== null) {
            return 'revoked';
        }
        if ($link->redeemedAt !== null) {
            return 'redeemed';
        }
        if ((int) $link->expiresAt <= ($nowMs ?? Dates::nowMillis())) {
            return 'expired';
        }

        return 'unusable';
    }
}
