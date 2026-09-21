<?php

declare(strict_types=1);

namespace App\Trpc\Routers;

use App\Support\AccessRules;
use App\Support\Audit;
use App\Support\Authz;
use App\Support\ColleagueProvisioning;
use App\Support\Dates;
use App\Trpc\Context;
use App\Trpc\Registry;
use App\Trpc\TrpcException;
use App\Trpc\Validate;
use Illuminate\Support\Facades\DB;

/**
 * colleagueInvitations.*, mirroring server/routers/colleagueInvitations.ts.
 *
 * An invitation decides, in advance, what somebody will be able to reach when
 * they first sign in. ColleagueProvisioning turns it into a membership at that
 * moment; this router is where the decision is made and recorded.
 *
 * Company administrator is deliberately not on the list of roles that can be
 * invited. Handing out the role that grants every other role is a decision
 * somebody makes about a person already in the system, from the access screens.
 */
final class ColleagueInvitationsRouter
{
    private const DAY_MS = 86400000;

    public static function register(Registry $registry): void
    {
        $registry->query('colleagueInvitations.list', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::assertAdmin($ctx, $input);

            $invitations = DB::table('colleagueInvitations')
                ->where('entityId', $entityId)->orderByDesc('createdAt')->get();

            $ids = $invitations->map(static fn ($row) => (int) $row->id)->all();

            $grantsByInvitation = [];
            if ($ids !== []) {
                foreach (DB::table('colleagueInvitationPropertyGrants as g')
                    ->join('properties as p', 'p.id', '=', 'g.propertyId')
                    ->whereIn('g.invitationId', $ids)
                    ->select(['g.invitationId', 'g.propertyId', 'p.name as propertyName', 'p.addressLine1'])
                    ->get() as $grant) {
                    $grantsByInvitation[(int) $grant->invitationId][] = (array) $grant;
                }
            }

            $now = Dates::nowMillis();

            return $invitations->map(static function ($row) use ($grantsByInvitation, $now): array {
                $invitation = (array) $row;
                // A pending invitation past its expiry is shown as expired
                // without waiting for anything to rewrite the row.
                $invitation['effectiveStatus'] = $row->status === 'pending' && (int) $row->expiresAt <= $now
                    ? 'expired'
                    : $row->status;
                $invitation['propertyGrants'] = $grantsByInvitation[(int) $row->id] ?? [];

                return $invitation;
            })->all();
        });

        $registry->mutation('colleagueInvitations.create', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::assertAdmin($ctx, $input);

            $email = Validate::email($input['email'] ?? null);
            $emailNormalized = ColleagueProvisioning::normaliseEmail($email);
            $role = Validate::enum($input['role'] ?? null, self::invitableRoles(), 'role');
            $allProperties = Validate::bool($input['allProperties'] ?? null, 'allProperties');
            $expiresInDays = Validate::int($input['expiresInDays'] ?? 14, 'expiresInDays', 1, 30);
            $reason = AccessRules::requireMeaningfulReason(Validate::string($input['reason'] ?? null, 'reason', 20, 1200));

            $extras = AccessRules::normaliseManaged(
                Validate::arrayOf($input['extraCapabilities'] ?? [], 'extraCapabilities', count(AccessRules::MANAGEABLE_CAPABILITIES)),
            );

            $propertyIds = [];
            if (!$allProperties) {
                foreach (Validate::arrayOf($input['propertyIds'] ?? [], 'propertyIds', 250) as $index => $propertyId) {
                    $id = Validate::id($propertyId, "propertyIds.$index");
                    if (!in_array($id, $propertyIds, true)) {
                        $propertyIds[] = $id;
                    }
                }
                sort($propertyIds);

                if ($propertyIds === []) {
                    throw TrpcException::badRequest('Select at least one property or grant access to all company properties.');
                }
            }

            $expiresAt = Dates::nowMillis() + $expiresInDays * self::DAY_MS;

            $id = DB::transaction(static function () use (
                $ctx, $entityId, $email, $emailNormalized, $role, $allProperties, $propertyIds, $extras, $expiresAt
            ): int {
                // One live invitation per address per company: two would give
                // two different answers to what this person may reach.
                $existing = DB::table('colleagueInvitations')
                    ->where('entityId', $entityId)
                    ->where('emailNormalized', $emailNormalized)
                    ->where('status', 'pending')
                    ->where('expiresAt', '>', Dates::nowMillis())
                    ->first('id');

                if ($existing !== null) {
                    throw TrpcException::conflict(
                        'This colleague already has a pending invitation for this company. Revoke it first or wait for it to expire.'
                    );
                }

                if ($propertyIds !== []) {
                    $valid = DB::table('properties')
                        ->where('entityId', $entityId)->whereIn('id', $propertyIds)->count();
                    if ($valid !== count($propertyIds)) {
                        throw TrpcException::badRequest('One or more selected properties do not belong to this company.');
                    }
                }

                $id = (int) DB::table('colleagueInvitations')->insertGetId([
                    'entityId' => $entityId,
                    'email' => trim($email),
                    'emailNormalized' => $emailNormalized,
                    'operationalRole' => $role,
                    'allProperties' => $allProperties ? 1 : 0,
                    'extraCapabilities' => json_encode($extras, JSON_UNESCAPED_SLASHES),
                    'expiresAt' => $expiresAt,
                    'createdBy' => $ctx->userId(),
                ]);

                foreach ($propertyIds as $propertyId) {
                    DB::table('colleagueInvitationPropertyGrants')->insert([
                        'invitationId' => $id,
                        'propertyId' => $propertyId,
                    ]);
                }

                return $id;
            });

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'colleague_invitation.create',
                'resourceType' => 'colleague_invitation',
                'resourceId' => $id,
                'sensitivity' => 'restricted',
                'result' => 'success',
                'reasonCode' => 'preauthorised_provider_signin',
                // The domain rather than the address: enough to review who is
                // being invited in without putting a personal email in the log.
                'metadata' => [
                    'emailDomain' => self::domainOf($emailNormalized),
                    'role' => $role, 'allProperties' => $allProperties, 'propertyIds' => $propertyIds,
                    'extraCapabilities' => $extras, 'expiresAt' => $expiresAt, 'reason' => $reason,
                ],
            ]);

            return ['id' => $id, 'expiresAt' => $expiresAt];
        });

        $registry->mutation('colleagueInvitations.revoke', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::assertAdmin($ctx, $input);
            $id = Validate::id($input['id'] ?? null, 'id');
            $reason = AccessRules::requireMeaningfulReason(Validate::string($input['reason'] ?? null, 'reason', 20, 1200));

            $invitation = DB::table('colleagueInvitations')
                ->where('id', $id)->where('entityId', $entityId)
                ->first(['id', 'status', 'emailNormalized']);

            if ($invitation === null) {
                throw TrpcException::notFound('Colleague invitation not found.');
            }

            // An accepted or already-revoked invitation is left as it is, but
            // the attempt is still recorded: somebody tried to withdraw access
            // that had already been taken up.
            if ($invitation->status === 'pending') {
                DB::table('colleagueInvitations')->where('id', $invitation->id)
                    ->update(['status' => 'revoked', 'revokedAt' => Dates::nowMillis()]);
            }

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'colleague_invitation.revoke',
                'resourceType' => 'colleague_invitation',
                'resourceId' => (int) $invitation->id,
                'sensitivity' => 'restricted',
                'result' => 'success',
                'metadata' => [
                    'emailDomain' => self::domainOf((string) $invitation->emailNormalized),
                    'alreadyFinal' => $invitation->status !== 'pending',
                    'reason' => $reason,
                ],
            ]);

            return ['success' => true];
        });
    }

    /** @return array<int, string> */
    private static function invitableRoles(): array
    {
        return array_values(array_filter(
            AccessRules::MANAGEABLE_ROLES,
            static fn (string $role) => $role !== 'owner',
        ));
    }

    private static function assertAdmin(Context $ctx, mixed $input): int
    {
        $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
        Authz::assertEntityCapability($ctx->userId(), $entityId, 'config.write');

        return $entityId;
    }

    private static function domainOf(string $email): ?string
    {
        $parts = explode('@', $email);

        return count($parts) === 2 ? $parts[1] : null;
    }
}
