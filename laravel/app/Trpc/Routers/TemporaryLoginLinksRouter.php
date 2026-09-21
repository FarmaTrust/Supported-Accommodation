<?php

declare(strict_types=1);

namespace App\Trpc\Routers;

use App\Support\Audit;
use App\Support\Authz;
use App\Support\Dates;
use App\Support\LocalAuth;
use App\Support\SecureLinks;
use App\Support\TemporaryLoginLinks;
use App\Support\Users;
use App\Trpc\Context;
use App\Trpc\Registry;
use App\Trpc\TrpcException;
use App\Trpc\Validate;
use Illuminate\Support\Facades\DB;

/**
 * temporaryLoginLinks.*, mirroring server/routers/temporaryLoginLinks.ts.
 *
 * A link that signs somebody in as their existing account — the strongest thing
 * this system issues. It is bounded on every side: single use, at most 30 days,
 * stored only as a hash, and issued only for an account that is already active,
 * already a member of the company and already holds local credentials. It never
 * creates an account and never widens one.
 *
 * Issuing a new link revokes any live link for the same person, so there is
 * never more than one way in at a time.
 */
final class TemporaryLoginLinksRouter
{
    private const UNAVAILABLE = 'This temporary sign-in link is unavailable. Ask your company administrator for a new link.';

    public static function register(Registry $registry): void
    {
        $registry->query('temporaryLoginLinks.list', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::assertAdmin($ctx, $input);

            // The hash is never returned: a link is issued once and after that
            // can only be revoked, not read back.
            return DB::table('temporaryLoginLinks as l')
                ->join('users as u', 'u.id', '=', 'l.targetUserId')
                ->where('l.entityId', $entityId)
                ->orderByDesc('l.createdAt')
                ->select([
                    'l.id', 'l.targetUserId', 'u.name as recipientName', 'u.email as recipientEmail',
                    'l.expiresAt', 'l.redeemedAt', 'l.revokedAt', 'l.createdAt',
                ])->get()->map(static fn ($r) => (array) $r)->all();
        });

        $registry->mutation('temporaryLoginLinks.issue', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::assertAdmin($ctx, $input);
            $targetUserId = Validate::id($input['targetUserId'] ?? null, 'targetUserId');
            $expiresInDays = Validate::int(
                $input['expiresInDays'] ?? null, 'expiresInDays',
                TemporaryLoginLinks::MIN_DAYS, TemporaryLoginLinks::MAX_DAYS,
            );
            $reason = Validate::string($input['reason'] ?? null, 'reason', 20, 1200);

            $now = Dates::nowMillis();

            $target = DB::table('users')->where('id', $targetUserId)->first(['id', 'accountStatus']);
            if ($target === null) {
                throw TrpcException::notFound('The selected account is not available.');
            }
            if ($target->accountStatus !== 'active') {
                throw TrpcException::forbidden('The selected account is not active. Reactivate it before issuing temporary access.');
            }

            if (!self::hasActiveMembership($targetUserId, $entityId, $now)) {
                throw TrpcException::forbidden('The selected account does not have active access to this company.');
            }

            // The link signs somebody in as an account that can already sign in.
            // Without a credential there is no account to sign in as, only a
            // shell, and a link would be a way to create access rather than
            // restore it.
            $credential = DB::table('localAuthCredentials')
                ->where('userId', $targetUserId)->first(['id', 'lockedUntil']);

            if ($credential === null) {
                throw TrpcException::badRequest(
                    'The selected account does not have local sign-in credentials. Issue approved local credentials first.'
                );
            }
            if ($credential->lockedUntil !== null && (int) $credential->lockedUntil > $now) {
                throw TrpcException::forbidden(
                    'The selected account is temporarily locked. Use the normal recovery process before issuing temporary access.'
                );
            }

            $token = TemporaryLoginLinks::createToken();
            $expiresAt = TemporaryLoginLinks::expiresAt($expiresInDays, $now);

            $created = DB::transaction(static function () use ($ctx, $entityId, $targetUserId, $token, $expiresAt, $now): array {
                // Any live link for this person is retired first, so there is
                // never more than one way in at a time.
                $superseded = DB::table('temporaryLoginLinks')
                    ->where('entityId', $entityId)
                    ->where('targetUserId', $targetUserId)
                    ->whereNull('revokedAt')
                    ->whereNull('redeemedAt')
                    ->where('expiresAt', '>', $now)
                    ->update(['revokedAt' => $now]);

                $id = (int) DB::table('temporaryLoginLinks')->insertGetId([
                    'entityId' => $entityId,
                    'targetUserId' => $targetUserId,
                    'tokenHash' => SecureLinks::hashToken($token),
                    'expiresAt' => $expiresAt,
                    'createdBy' => $ctx->userId(),
                ]);

                return ['id' => $id, 'supersededCount' => $superseded];
            });

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'temporary_login_link.issued',
                'resourceType' => 'temporary_login_link',
                'resourceId' => $created['id'],
                'sensitivity' => 'restricted',
                'result' => 'success',
                'reasonCode' => 'company_admin_existing_account_access',
                'metadata' => [
                    'targetUserId' => $targetUserId,
                    'expiresAt' => $expiresAt,
                    'expiresInDays' => $expiresInDays,
                    'reason' => $reason,
                    'supersededActiveLinks' => $created['supersededCount'],
                ],
            ]);

            // The only moment the token exists in plain text.
            return ['id' => $created['id'], 'token' => $token, 'expiresAt' => $expiresAt];
        });

        $registry->mutation('temporaryLoginLinks.revoke', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::assertAdmin($ctx, $input);
            $id = Validate::id($input['id'] ?? null, 'id');
            $reason = Validate::string($input['reason'] ?? null, 'reason', 20, 1200);

            $link = DB::table('temporaryLoginLinks')
                ->where('id', $id)->where('entityId', $entityId)
                ->first(['id', 'targetUserId', 'revokedAt', 'redeemedAt', 'expiresAt']);

            if ($link === null) {
                throw TrpcException::notFound('Temporary sign-in link not found.');
            }

            // Revoking a redeemed link would do nothing: the session it started
            // outlives the link, so the honest answer is to say what would.
            if ($link->redeemedAt !== null) {
                throw TrpcException::badRequest(
                    'This link has already been redeemed. Reset the password or suspend the account to revoke its session.'
                );
            }

            $now = Dates::nowMillis();

            if ($link->revokedAt === null) {
                DB::table('temporaryLoginLinks')
                    ->where('id', $link->id)
                    ->whereNull('redeemedAt')
                    ->whereNull('revokedAt')
                    ->update(['revokedAt' => $now]);
            }

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'temporary_login_link.revoked',
                'resourceType' => 'temporary_login_link',
                'resourceId' => (int) $link->id,
                'sensitivity' => 'restricted',
                'result' => 'success',
                'reasonCode' => 'company_admin_revocation',
                'metadata' => [
                    'targetUserId' => (int) $link->targetUserId,
                    'reason' => $reason,
                    'alreadyRevoked' => $link->revokedAt !== null,
                    'expiredAtRevocation' => (int) $link->expiresAt <= $now,
                ],
            ]);

            return ['success' => true];
        });

        $registry->mutation('temporaryLoginLinks.redeem', Registry::PUBLIC, static function (Context $ctx, mixed $input): array {
            $token = Validate::token($input['token'] ?? null, self::UNAVAILABLE, 32, 200);
            $tokenHash = SecureLinks::hashToken($token);
            $now = Dates::nowMillis();

            $outcome = DB::transaction(static function () use ($tokenHash, $now): array {
                $link = DB::table('temporaryLoginLinks')->where('tokenHash', $tokenHash)->first();

                if ($link === null || !TemporaryLoginLinks::isUsable($link, $now)) {
                    return [
                        'status' => 'denied',
                        'entityId' => $link === null ? null : (int) $link->entityId,
                        'linkId' => $link === null ? null : (int) $link->id,
                        'reasonCode' => 'unavailable_' . TemporaryLoginLinks::unavailableReason($link, $now),
                    ];
                }

                $targetUserId = (int) $link->targetUserId;
                $target = Users::byId($targetUserId);
                $credential = DB::table('localAuthCredentials')->where('userId', $targetUserId)
                    ->first(['passwordVersion', 'lockedUntil', 'mustChangePassword']);

                // The account's own state is checked again at redemption: a link
                // issued last week must not still work for somebody suspended
                // yesterday.
                if ($target === null
                    || $target['accountStatus'] !== 'active'
                    || !self::hasActiveMembership($targetUserId, (int) $link->entityId, $now)
                    || $credential === null
                    || ($credential->lockedUntil !== null && (int) $credential->lockedUntil > $now)) {
                    return [
                        'status' => 'denied',
                        'entityId' => (int) $link->entityId,
                        'linkId' => (int) $link->id,
                        'reasonCode' => 'recipient_not_eligible',
                    ];
                }

                // Single use is enforced here rather than by the read above: two
                // simultaneous redemptions both pass the checks, and only the
                // one that updates a row is allowed through.
                $consumed = DB::table('temporaryLoginLinks')
                    ->where('id', $link->id)
                    ->where('tokenHash', $tokenHash)
                    ->whereNull('revokedAt')
                    ->whereNull('redeemedAt')
                    ->where('expiresAt', '>', $now)
                    ->update(['redeemedAt' => $now]);

                if ($consumed !== 1) {
                    return [
                        'status' => 'denied',
                        'entityId' => (int) $link->entityId,
                        'linkId' => (int) $link->id,
                        'reasonCode' => 'concurrent_or_unusable',
                    ];
                }

                return [
                    'status' => 'allowed',
                    'entityId' => (int) $link->entityId,
                    'linkId' => (int) $link->id,
                    'user' => $target,
                    'passwordVersion' => (int) $credential->passwordVersion,
                    'mustChangePassword' => (int) $credential->mustChangePassword === 1,
                ];
            });

            if ($outcome['status'] === 'denied') {
                Audit::write([
                    'actorType' => 'secure_link',
                    'entityId' => $outcome['entityId'],
                    'action' => 'temporary_login_link.redeem',
                    'resourceType' => 'temporary_login_link',
                    'resourceId' => $outcome['linkId'],
                    'sensitivity' => 'restricted',
                    'result' => 'denied',
                    // The audit trail says which check failed; the caller is told
                    // only that the link is unavailable.
                    'reasonCode' => $outcome['reasonCode'],
                ]);

                throw TrpcException::notFound(self::UNAVAILABLE);
            }

            $ctx->setSessionCookie(LocalAuth::issueSession($outcome['user'], $outcome['passwordVersion']));

            Audit::write([
                'actorUserId' => (int) $outcome['user']['id'],
                'actorType' => 'secure_link',
                'entityId' => $outcome['entityId'],
                'action' => 'temporary_login_link.redeem',
                'resourceType' => 'temporary_login_link',
                'resourceId' => $outcome['linkId'],
                'sensitivity' => 'restricted',
                'result' => 'success',
                'reasonCode' => 'one_time_existing_account_session',
                'metadata' => ['mustChangePassword' => $outcome['mustChangePassword']],
            ]);

            return ['success' => true, 'mustChangePassword' => $outcome['mustChangePassword']];
        });
    }

    private static function assertAdmin(Context $ctx, mixed $input): int
    {
        $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
        Authz::assertEntityCapability($ctx->userId(), $entityId, 'config.write');

        return $entityId;
    }

    /** A membership that is active and within its own start and end dates. */
    private static function hasActiveMembership(int $userId, int $entityId, int $now): bool
    {
        return DB::table('entityMemberships')
            ->where('userId', $userId)
            ->where('entityId', $entityId)
            ->where('status', 'active')
            ->where(fn ($q) => $q->whereNull('startsAt')->orWhere('startsAt', '<=', $now))
            ->where(fn ($q) => $q->whereNull('endsAt')->orWhere('endsAt', '>', $now))
            ->exists();
    }
}
