<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * Turning a pending colleague invitation into real membership, mirroring
 * server/services/colleagueProvisioning.ts.
 *
 * An invitation is addressed to an email rather than to an account, so it can be
 * raised before the person has ever signed in. This runs on the first
 * authenticated moment we know the address belongs to them, which is why it is
 * called from sign-in and from the administrator credential path rather than
 * from the invitation screen.
 */
final class ColleagueProvisioning
{
    public static function normaliseEmail(string $email): string
    {
        return strtolower(trim($email));
    }

    /**
     * Accepts every live invitation addressed to this person's email.
     *
     * @return array<int, array{id: int, entityId: int, role: string, propertyIds: array<int, int>}>
     */
    public static function acceptPending(int $userId, ?string $email): array
    {
        $emailNormalized = $email === null ? '' : self::normaliseEmail($email);
        if ($emailNormalized === '') {
            return [];
        }

        $now = Dates::nowMillis();

        $accepted = DB::transaction(static function () use ($userId, $emailNormalized, $now): array {
            // A lapsed invitation is retired here rather than silently ignored,
            // so the company's invitation list reflects what is actually live.
            DB::table('colleagueInvitations')
                ->where('emailNormalized', $emailNormalized)
                ->where('status', 'pending')
                ->where('expiresAt', '<', $now)
                ->update(['status' => 'expired']);

            $pending = DB::table('colleagueInvitations')
                ->where('emailNormalized', $emailNormalized)
                ->where('status', 'pending')
                ->where('expiresAt', '>', $now)
                ->get();

            $applied = [];

            foreach ($pending as $invitation) {
                $entityId = (int) $invitation->entityId;

                // Somebody who already holds a membership keeps the access they
                // have: an invitation must not quietly widen or narrow it.
                $existing = DB::table('entityMemberships')
                    ->where('entityId', $entityId)->where('userId', $userId)->first('id');
                if ($existing !== null) {
                    continue;
                }

                $propertyIds = DB::table('colleagueInvitationPropertyGrants')
                    ->where('invitationId', $invitation->id)
                    ->pluck('propertyId')->map(static fn ($id) => (int) $id)->all();

                $allProperties = (int) $invitation->allProperties === 1;

                // An invitation that grants neither every property nor a named
                // one would create a membership that reaches nothing.
                if (!$allProperties && $propertyIds === []) {
                    continue;
                }

                // Every named property must still belong to the inviting company.
                if ($propertyIds !== []) {
                    $valid = DB::table('properties')
                        ->where('entityId', $entityId)->whereIn('id', $propertyIds)->count();
                    if ($valid !== count($propertyIds)) {
                        continue;
                    }
                }

                $extras = is_string($invitation->extraCapabilities)
                    ? (json_decode($invitation->extraCapabilities, true) ?? [])
                    : ($invitation->extraCapabilities ?? []);

                DB::table('entityMemberships')->insert([
                    'entityId' => $entityId,
                    'userId' => $userId,
                    'operationalRole' => $invitation->operationalRole,
                    'allProperties' => $allProperties ? 1 : 0,
                    'extraCapabilities' => json_encode(is_array($extras) ? array_values($extras) : [], JSON_UNESCAPED_SLASHES),
                    'status' => 'active',
                    'createdBy' => (int) $invitation->createdBy,
                ]);

                if (!$allProperties) {
                    foreach ($propertyIds as $propertyId) {
                        DB::table('propertyAssignments')->insert([
                            'entityId' => $entityId,
                            'propertyId' => $propertyId,
                            'userId' => $userId,
                            'assignmentType' => AccessRules::propertyAssignmentTypeFor((string) $invitation->operationalRole),
                            'createdBy' => (int) $invitation->createdBy,
                        ]);
                    }
                }

                DB::table('colleagueInvitations')->where('id', $invitation->id)->update([
                    'status' => 'accepted',
                    'acceptedAt' => $now,
                    'acceptedByUserId' => $userId,
                ]);

                $applied[] = [
                    'id' => (int) $invitation->id,
                    'entityId' => $entityId,
                    'role' => (string) $invitation->operationalRole,
                    'propertyIds' => $propertyIds,
                ];
            }

            return $applied;
        });

        // Audit writes are chained, so they happen after the transaction rather
        // than inside it: a rolled-back membership must not leave a hash link
        // behind claiming it was granted.
        foreach ($accepted as $invitation) {
            Audit::write([
                'actorUserId' => $userId,
                'entityId' => $invitation['entityId'],
                'action' => 'colleague_invitation.accept',
                'resourceType' => 'colleague_invitation',
                'resourceId' => $invitation['id'],
                'sensitivity' => 'restricted',
                'result' => 'success',
                'reasonCode' => 'provider_verified_email_match',
                'metadata' => ['role' => $invitation['role'], 'propertyIds' => $invitation['propertyIds']],
            ]);
        }

        return $accepted;
    }
}
