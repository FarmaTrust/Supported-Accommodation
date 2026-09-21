<?php

declare(strict_types=1);

namespace App\Support;

/**
 * Share links, mirroring server/services/security.ts.
 *
 * A provider pack is sometimes sent to a placing authority who has no account,
 * so the link itself is the credential. Only its hash is stored: a leaked
 * database row then cannot be turned back into a working link.
 */
final class SecureLinks
{
    public static function hashToken(string $token): string
    {
        return hash('sha256', $token);
    }

    public static function createToken(): string
    {
        return Jwt::base64UrlEncode(random_bytes(32));
    }

    /**
     * Three separate limits, any one of which closes the link: revoked by hand,
     * past its expiry, or already opened as many times as allowed.
     */
    public static function isUsable(object $link, ?int $nowMs = null): bool
    {
        $now = $nowMs ?? Dates::nowMillis();

        if ($link->revokedAt !== null) {
            return false;
        }
        if ((int) $link->expiresAt <= $now) {
            return false;
        }
        if ($link->maxViews !== null && (int) $link->viewCount >= (int) $link->maxViews) {
            return false;
        }

        return true;
    }

    /** The same three limits for a guest invitation, which is counted by use. */
    public static function isInvitationUsable(object $invitation, ?int $nowMs = null): bool
    {
        $now = $nowMs ?? Dates::nowMillis();

        if ($invitation->revokedAt !== null) {
            return false;
        }
        if ((int) $invitation->expiresAt <= $now) {
            return false;
        }

        return (int) $invitation->useCount < (int) $invitation->maxUses;
    }
}
