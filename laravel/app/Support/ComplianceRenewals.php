<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * The compliance renewal sweep, mirroring
 * server/services/complianceRenewals.ts.
 *
 * Walks every property certificate and staff check in a company, works out
 * which are close enough to expiry to be worth chasing, and raises a
 * notification for the person who has to act. Where an email connection exists
 * it also stages an outbox row.
 *
 * Nothing here sends anything. The outbox is deliberately a draft: this
 * deployment has no email provider connected, and a renewal chase that silently
 * fails to send is worse than one sitting visibly unsent.
 */
final class ComplianceRenewals
{
    private const JSON_FLAGS = JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE;

    /**
     * @return array{evaluated: int, candidates: int, notificationsUpserted: int, outboxUpserted: int, emailProviderActive: bool}
     */
    public static function run(int $entityId, ?int $nowMs = null): array
    {
        $now = $nowMs ?? Dates::nowMillis();

        $propertyRows = DB::table('propertyEvidence')->where('entityId', $entityId)->get();
        $staffRows = DB::table('workforceChecks')->where('entityId', $entityId)->get();
        $profiles = DB::table('staffProfiles')->where('entityId', $entityId)->get();
        $memberships = DB::table('entityMemberships')
            ->where('entityId', $entityId)->where('status', 'active')->get();
        $assignments = DB::table('propertyAssignments')->where('entityId', $entityId)->get();

        $profilesById = [];
        foreach ($profiles as $profile) {
            $profilesById[(int) $profile->id] = $profile;
        }

        $memberIds = $memberships->map(static fn ($m) => (int) $m->userId)->all();
        $emailByUser = $memberIds === [] ? [] : DB::table('users')
            ->whereIn('id', $memberIds)->pluck('email', 'id')->all();

        // When nobody owns the record, the chase goes to whoever holds the role
        // that would have to deal with it. An unowned renewal must still reach a
        // person.
        $fallback = static function (array $roles) use ($memberships): ?int {
            foreach ($roles as $role) {
                foreach ($memberships as $membership) {
                    if ($membership->operationalRole === $role) {
                        return (int) $membership->userId;
                    }
                }
            }

            return null;
        };

        $items = [];

        foreach ($propertyRows as $row) {
            if ($row->status === 'closed' || $row->dueAt === null) {
                continue;
            }

            $category = RenewalRules::propertyCategory((string) $row->recordType, (string) $row->title, $row->details);
            if ($category === null) {
                continue;
            }

            $band = RenewalRules::band((int) $row->dueAt, $now);
            if (!in_array($band['band'], RenewalRules::ACTIONABLE_BANDS, true)) {
                continue;
            }

            $recipient = $row->ownerUserId === null ? null : (int) $row->ownerUserId;
            $recipient ??= self::assignedManager($assignments, (int) $row->propertyId, $now);
            $recipient ??= $fallback(['registered_manager', 'hr_compliance', 'owner']);

            $items[] = [
                'resourceType' => 'property_evidence',
                'resourceId' => (int) $row->id,
                'title' => Rules::PROPERTY_COMPLIANCE_LABELS[$category],
                'subject' => (string) $row->title,
                'dueAt' => (int) $row->dueAt,
                'recipientUserId' => $recipient,
                'recipientEmail' => $recipient === null ? null : ($emailByUser[$recipient] ?? null),
                'deepLink' => '/compliance-dashboard?view=property',
            ];
        }

        foreach ($staffRows as $row) {
            if (in_array($row->status, ['not_applicable', 'rejected'], true) || $row->expiresAt === null) {
                continue;
            }

            $category = RenewalRules::staffCategory((string) $row->checkType, $row->level);
            if ($category === null) {
                continue;
            }

            $band = RenewalRules::band((int) $row->expiresAt, $now);
            if (!in_array($band['band'], RenewalRules::ACTIONABLE_BANDS, true)) {
                continue;
            }

            $profile = $profilesById[(int) $row->staffProfileId] ?? null;
            if ($profile === null) {
                continue;
            }

            // The manager first, then the worker themselves: a DBS is the
            // worker's to renew but the manager's to chase.
            $recipient = $profile->managerUserId === null ? null : (int) $profile->managerUserId;
            $recipient ??= $profile->userId === null ? null : (int) $profile->userId;
            $recipient ??= $fallback(['hr_compliance', 'registered_manager', 'owner']);

            $items[] = [
                'resourceType' => 'workforce_check',
                'resourceId' => (int) $row->id,
                'title' => RenewalRules::STAFF_LABELS[$category],
                'subject' => $profile->fullName . ' — ' . $row->title,
                'dueAt' => (int) $row->expiresAt,
                'recipientUserId' => $recipient,
                'recipientEmail' => $recipient === null
                    ? $profile->email
                    : ($emailByUser[$recipient] ?? $profile->email),
                'deepLink' => '/compliance-dashboard?view=staff&staff=' . (int) $profile->id,
            ];
        }

        $createdBy = $fallback(['owner']) ?? ($memberships->first()->userId ?? null);
        $createdBy = $createdBy === null ? null : (int) $createdBy;

        $connection = DB::table('integrationConnections')
            ->where('entityId', $entityId)->where('integrationType', 'email')->first();

        // The placeholder connection exists so the outbox has somewhere to live
        // and the workspace can say plainly that no provider is connected.
        if ($items !== [] && $connection === null && $createdBy !== null) {
            $connectionId = (int) DB::table('integrationConnections')->insertGetId([
                'entityId' => $entityId,
                'name' => 'Compliance renewal email — provider not connected',
                'integrationType' => 'email',
                'adapterType' => 'smtp_api',
                'direction' => 'outbound',
                'status' => 'draft',
                'scopes' => json_encode(['compliance.renewal'], self::JSON_FLAGS),
                'config' => json_encode(['mode' => 'email_ready_outbox', 'providerConnected' => false], self::JSON_FLAGS),
                'allowedResourceTypes' => json_encode(['property_evidence', 'workforce_check'], self::JSON_FLAGS),
                'createdBy' => $createdBy,
            ]);
            $connection = DB::table('integrationConnections')->where('id', $connectionId)->first();
        }

        $notificationsUpserted = 0;
        $outboxUpserted = 0;

        foreach ($items as $item) {
            if ($item['recipientUserId'] === null) {
                continue;
            }

            $band = RenewalRules::band($item['dueAt'], $now);
            $date = gmdate('d/m/Y', intdiv($item['dueAt'], 1000));
            $message = "{$item['subject']} renews on $date. {$band['label']}.";

            // Keyed by band, so a certificate raises a fresh alert as it moves
            // from three months to one month to overdue rather than one that is
            // easy to leave read.
            DB::table('notifications')->upsert(
                [[
                    'entityId' => $entityId,
                    'userId' => $item['recipientUserId'],
                    'type' => 'compliance_renewal',
                    'title' => $item['title'] . ' renewal',
                    'message' => $message,
                    'severity' => $band['severity'],
                    'resourceType' => $item['resourceType'],
                    'resourceId' => $item['resourceId'],
                    'deepLink' => $item['deepLink'],
                    'dueAt' => $item['dueAt'],
                    'acknowledgementRequired' => 1,
                    'dedupeKey' => RenewalRules::dedupeKey(
                        $item['resourceType'], $item['resourceId'], $band['band'], $item['recipientUserId'],
                    ),
                ]],
                ['userId', 'dedupeKey'],
                // resolvedAt is cleared: a renewal that has come round again is
                // outstanding once more.
                ['title', 'message', 'severity', 'deepLink', 'dueAt', 'resolvedAt'],
            );
            $notificationsUpserted++;

            if ($connection === null) {
                continue;
            }

            $payload = [
                'subject' => 'Action required: ' . $item['title'] . ' renewal',
                'text' => $message,
                'deepLink' => $item['deepLink'],
                'dueAt' => $item['dueAt'],
                'band' => $band['band'],
            ];
            $payloadJson = (string) json_encode($payload, self::JSON_FLAGS);

            DB::table('integrationDeliveries')->upsert(
                [[
                    'entityId' => $entityId,
                    'connectionId' => (int) $connection->id,
                    'deliveryType' => 'email',
                    'resourceType' => $item['resourceType'],
                    'resourceId' => (string) $item['resourceId'],
                    'idempotencyKey' => RenewalRules::outboxDedupeKey(
                        $item['resourceType'], $item['resourceId'], $band['band'], $item['recipientUserId'],
                    ),
                    'payloadSnapshot' => $payloadJson,
                    'payloadHash' => hash('sha256', $payloadJson),
                    'status' => 'draft',
                    'recipientSnapshot' => (string) json_encode([
                        'userId' => $item['recipientUserId'],
                        'email' => $item['recipientEmail'],
                    ], self::JSON_FLAGS),
                    'scheduledFor' => $now,
                    // Why it is sitting there, written where whoever opens the
                    // outbox will read it.
                    'lastError' => $item['recipientEmail'] !== null && $item['recipientEmail'] !== ''
                        ? 'Email provider is not connected; message remains in the outbox.'
                        : 'Recipient has no email address; add one before activating delivery.',
                    'createdBy' => $createdBy,
                ]],
                ['connectionId', 'idempotencyKey'],
                ['payloadSnapshot', 'recipientSnapshot', 'scheduledFor'],
            );
            $outboxUpserted++;
        }

        Audit::write([
            'actorType' => 'scheduled_job',
            'entityId' => $entityId,
            'action' => 'compliance_renewal.evaluate',
            'resourceType' => 'entity',
            'resourceId' => $entityId,
            'result' => 'success',
            'metadata' => [
                'candidates' => count($items),
                'notificationsUpserted' => $notificationsUpserted,
                'outboxUpserted' => $outboxUpserted,
                'emailProviderActive' => false,
            ],
        ]);

        return [
            'evaluated' => $propertyRows->count() + $staffRows->count(),
            'candidates' => count($items),
            'notificationsUpserted' => $notificationsUpserted,
            'outboxUpserted' => $outboxUpserted,
            'emailProviderActive' => false,
        ];
    }

    /** The manager or compliance lead currently assigned to a property. */
    private static function assignedManager(iterable $assignments, int $propertyId, int $now): ?int
    {
        foreach ($assignments as $assignment) {
            if ((int) $assignment->propertyId !== $propertyId
                || !in_array($assignment->assignmentType, ['manager', 'compliance'], true)) {
                continue;
            }
            if ($assignment->startsAt !== null && (int) $assignment->startsAt > $now) {
                continue;
            }
            if ($assignment->endsAt !== null && (int) $assignment->endsAt <= $now) {
                continue;
            }

            return (int) $assignment->userId;
        }

        return null;
    }
}
