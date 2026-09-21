<?php

declare(strict_types=1);

namespace App\Trpc\Routers;

use App\Support\Audit;
use App\Support\Authz;
use App\Support\Dates;
use App\Support\SecureLinks;
use App\Trpc\Context;
use App\Trpc\Registry;
use App\Trpc\TrpcException;
use App\Trpc\Validate;
use Illuminate\Support\Facades\DB;

/**
 * guestInvitations.*, mirroring server/routers/guestInvitations.ts.
 *
 * A link that shows one property's summary to somebody with no account — an
 * inspector arriving, a placing authority checking an address. The link is the
 * credential, so only its hash is stored and it carries its own expiry and use
 * count.
 *
 * Redemption is public. It answers with the same message for an unknown token,
 * a revoked one, an expired one and an exhausted one, because telling them
 * apart would turn the endpoint into a way to probe which links exist.
 */
final class GuestInvitationsRouter
{
    private const HOUR_MS = 3600000;

    private const UNAVAILABLE = 'This guest link is unavailable. Ask the organisation that issued it for a new invitation.';

    public static function register(Registry $registry): void
    {
        $registry->query('guestInvitations.list', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::assertAdmin($ctx, $input);

            // The token hash is never returned: a link can be issued once and
            // then only revoked, never read back.
            return DB::table('guestInvitations as g')
                ->join('properties as p', 'p.id', '=', 'g.propertyId')
                ->where('g.entityId', $entityId)
                ->orderByDesc('g.createdAt')
                ->select([
                    'g.id', 'g.propertyId', 'p.name as propertyName', 'p.addressLine1 as propertyAddress',
                    'g.purpose', 'g.recipientLabel', 'g.expiresAt', 'g.maxUses', 'g.useCount',
                    'g.revokedAt', 'g.lastAccessedAt', 'g.createdAt',
                ])->get()->map(static fn ($r) => (array) $r)->all();
        });

        $registry->mutation('guestInvitations.create', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::assertAdmin($ctx, $input);
            $propertyId = Validate::id($input['propertyId'] ?? null, 'propertyId');

            $property = DB::table('properties')
                ->where('id', $propertyId)->where('entityId', $entityId)->first('id');
            if ($property === null) {
                throw TrpcException::notFound('The selected property does not belong to this company.');
            }

            $recipientLabel = Validate::optionalString($input['recipientLabel'] ?? null, 'recipientLabel', 180);
            $expiresInHours = Validate::int($input['expiresInHours'] ?? 72, 'expiresInHours', 1, 168);
            $maxUses = Validate::int($input['maxUses'] ?? 1, 'maxUses', 1, 10);

            $token = SecureLinks::createToken();
            $expiresAt = Dates::nowMillis() + $expiresInHours * self::HOUR_MS;

            $id = (int) DB::table('guestInvitations')->insertGetId([
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'purpose' => 'property_summary',
                'recipientLabel' => $recipientLabel,
                'tokenHash' => SecureLinks::hashToken($token),
                'expiresAt' => $expiresAt,
                'maxUses' => $maxUses,
                'createdBy' => $ctx->userId(),
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'action' => 'guest_invitation.create',
                'resourceType' => 'guest_invitation',
                'resourceId' => $id,
                'sensitivity' => 'restricted',
                'result' => 'success',
                // The recipient's name is not recorded, only that one was given.
                'metadata' => [
                    'purpose' => 'property_summary', 'expiresAt' => $expiresAt,
                    'maxUses' => $maxUses, 'hasRecipientLabel' => $recipientLabel !== null,
                ],
            ]);

            // The only moment the token exists in plain text.
            return ['id' => $id, 'token' => $token, 'expiresAt' => $expiresAt, 'maxUses' => $maxUses];
        });

        $registry->mutation('guestInvitations.revoke', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::assertAdmin($ctx, $input);
            $id = Validate::id($input['id'] ?? null, 'id');

            $invitation = DB::table('guestInvitations')
                ->where('id', $id)->where('entityId', $entityId)
                ->first(['id', 'propertyId', 'revokedAt']);

            if ($invitation === null) {
                throw TrpcException::notFound('Guest invitation not found.');
            }

            // Revoking twice is not an error; the first revocation time is kept.
            if ($invitation->revokedAt === null) {
                DB::table('guestInvitations')->where('id', $invitation->id)
                    ->update(['revokedAt' => Dates::nowMillis()]);
            }

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'propertyId' => (int) $invitation->propertyId,
                'action' => 'guest_invitation.revoke',
                'resourceType' => 'guest_invitation',
                'resourceId' => (int) $invitation->id,
                'sensitivity' => 'restricted',
                'result' => 'success',
                'metadata' => ['alreadyRevoked' => $invitation->revokedAt !== null],
            ]);

            return ['success' => true];
        });

        $registry->mutation('guestInvitations.redeem', Registry::PUBLIC, static function (Context $ctx, mixed $input): array {
            $token = Validate::token($input['token'] ?? null, self::UNAVAILABLE, 32, 200);
            $tokenHash = SecureLinks::hashToken($token);
            $now = Dates::nowMillis();

            $outcome = DB::transaction(static function () use ($tokenHash, $now): array {
                $invitation = DB::table('guestInvitations')->where('tokenHash', $tokenHash)->first();

                if ($invitation === null || !SecureLinks::isInvitationUsable($invitation, $now)) {
                    return [
                        'status' => 'denied',
                        'entityId' => $invitation === null ? null : (int) $invitation->entityId,
                        'propertyId' => $invitation === null ? null : (int) $invitation->propertyId,
                        'reasonCode' => 'invalid_or_unusable',
                    ];
                }

                // The limits are repeated in the where clause, so two
                // simultaneous redemptions of a single-use link cannot both
                // succeed: whichever loses updates no rows and is refused.
                $affected = DB::table('guestInvitations')
                    ->where('id', $invitation->id)
                    ->whereNull('revokedAt')
                    ->where('expiresAt', '>', $now)
                    ->whereColumn('useCount', '<', 'maxUses')
                    ->update([
                        'useCount' => DB::raw('useCount + 1'),
                        'lastAccessedAt' => $now,
                    ]);

                if ($affected !== 1) {
                    return [
                        'status' => 'denied',
                        'entityId' => (int) $invitation->entityId,
                        'propertyId' => (int) $invitation->propertyId,
                        'reasonCode' => 'concurrent_or_exhausted',
                    ];
                }

                $entity = DB::table('entities')->where('id', $invitation->entityId)->first('name');
                $property = DB::table('properties')
                    ->where('id', $invitation->propertyId)->where('entityId', $invitation->entityId)
                    ->first([
                        'id', 'name', 'addressLine1', 'addressLine2', 'city', 'postcode',
                        'accommodationType', 'capacity', 'status',
                    ]);

                if ($entity === null || $property === null) {
                    return [
                        'status' => 'denied',
                        'entityId' => (int) $invitation->entityId,
                        'propertyId' => (int) $invitation->propertyId,
                        'reasonCode' => 'scope_missing',
                    ];
                }

                return [
                    'status' => 'allowed',
                    'invitationId' => (int) $invitation->id,
                    'entityId' => (int) $invitation->entityId,
                    'propertyId' => (int) $invitation->propertyId,
                    'expiresAt' => (int) $invitation->expiresAt,
                    'remainingUses' => max(0, (int) $invitation->maxUses - (int) $invitation->useCount - 1),
                    'entity' => (array) $entity,
                    'property' => (array) $property,
                ];
            });

            if ($outcome['status'] === 'denied') {
                Audit::write([
                    'actorType' => 'secure_link',
                    'entityId' => $outcome['entityId'],
                    'propertyId' => $outcome['propertyId'],
                    'action' => 'guest_invitation.redeem',
                    'resourceType' => 'guest_invitation',
                    'sensitivity' => 'restricted',
                    'result' => 'denied',
                    // The audit trail records which limit closed the link even
                    // though the caller is told only that it is unavailable.
                    'reasonCode' => $outcome['reasonCode'],
                ]);

                throw TrpcException::notFound(self::UNAVAILABLE);
            }

            Audit::write([
                'actorType' => 'secure_link',
                'entityId' => $outcome['entityId'],
                'propertyId' => $outcome['propertyId'],
                'action' => 'guest_invitation.redeem',
                'resourceType' => 'guest_invitation',
                'resourceId' => $outcome['invitationId'],
                'sensitivity' => 'restricted',
                'result' => 'allowed',
                'reasonCode' => 'property_summary_only',
                'metadata' => ['remainingUses' => $outcome['remainingUses']],
            ]);

            return [
                'purpose' => 'property_summary',
                'expiresAt' => $outcome['expiresAt'],
                'remainingUses' => $outcome['remainingUses'],
                'organisation' => ['name' => $outcome['entity']['name']],
                'property' => $outcome['property'],
            ];
        });
    }

    private static function assertAdmin(Context $ctx, mixed $input): int
    {
        $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
        Authz::assertEntityCapability($ctx->userId(), $entityId, 'config.write');

        return $entityId;
    }
}
