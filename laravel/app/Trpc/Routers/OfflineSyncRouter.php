<?php

declare(strict_types=1);

namespace App\Trpc\Routers;

use App\Support\Audit;
use App\Support\Authz;
use App\Support\Dates;
use App\Support\EncryptedFields;
use App\Support\OfflineSyncRules;
use App\Support\WorkspacePolicy;
use App\Trpc\Context;
use App\Trpc\Registry;
use App\Trpc\TrpcException;
use App\Trpc\Validate;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * offlineSync.syncBatch, mirroring server/routers/offlineSync.ts.
 *
 * A worker in a house with no signal keeps recording, and the device sends the
 * queue when it reconnects. Every item is a claim about something that happened
 * when this server was not watching, so each one is checked again on arrival
 * rather than trusted: the access the worker had then may not be the access they
 * have now, and the record they wrote against may have moved.
 *
 * Nothing is ever silently dropped. An item that cannot be applied is stored as
 * a receipt with a reason, so the device can show the worker what did not go
 * through and why. Every item carries an idempotency key, so a retried batch
 * reports what already happened rather than writing it twice.
 */
final class OfflineSyncRouter
{
    private const MAX_BATCH = 20;

    /** @var array<int, string> */
    private const OPERATIONS = [
        'key_worker_report', 'incident', 'clock_event', 'handover', 'visitor_entry',
        'curfew_check', 'missing_episode', 'medication_administration', 'property_check',
        'maintenance_job', 'resident_finance_transaction', 'lone_worker_check_in',
    ];

    /**
     * The capability each operation needs. Recording an incident is not the same
     * permission as moving a young person's money.
     *
     * @var array<string, string>
     */
    private const CAPABILITIES = [
        'incident' => 'incident.write',
        'missing_episode' => 'incident.write',
        'medication_administration' => 'medication.write',
        'resident_finance_transaction' => 'resident_finance.write',
        'key_worker_report' => 'young_person.write',
    ];

    private const DEFAULT_CAPABILITY = 'frontline.write';

    private const NOTIFIABLE_INCIDENT_CATEGORIES = [
        'exploitation', 'police', 'abuse_allegation', 'child_protection_enquiry', 'restraint',
    ];

    public static function register(Registry $registry): void
    {
        $registry->mutation('offlineSync.syncBatch', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $items = Validate::arrayOf($input['items'] ?? null, 'items', self::MAX_BATCH);

            if ($items === []) {
                throw TrpcException::badRequest('Send at least one queued item.');
            }

            $results = [];
            foreach ($items as $index => $item) {
                $item = self::readItem($item, $index);

                // The batch belongs to one company. A mixed batch is refused
                // whole rather than part-applied.
                if ($item['payload']['entityId'] !== $entityId) {
                    throw TrpcException::badRequest('Every queued item must match the selected entity');
                }

                $results[] = self::reconcile($ctx->userId(), $item);
            }

            // The device uses serverTime to work out how far its own clock has
            // drifted before it queues anything else.
            return ['serverTime' => Dates::nowMillis(), 'results' => $results];
        });
    }

    /**
     * Reads one queued item into its envelope and payload.
     *
     * Only the fields the applier uses are read out; anything else the device
     * sent is ignored rather than written.
     *
     * @return array{idempotencyKey: string, operation: string, clientVersion: int, clientCreatedAt: int, expiresAt: int, basePlacementUpdatedAt: int, payload: array<string, mixed>}
     */
    private static function readItem(mixed $item, int $index): array
    {
        $item = Validate::object($item, "items.$index");
        $payload = Validate::object($item['payload'] ?? null, "items.$index.payload");

        return [
            'idempotencyKey' => Validate::string($item['idempotencyKey'] ?? null, "items.$index.idempotencyKey", 1, 100),
            'operation' => Validate::enum($item['operation'] ?? null, self::OPERATIONS, "items.$index.operation"),
            'clientVersion' => Validate::int($item['clientVersion'] ?? null, "items.$index.clientVersion"),
            'clientCreatedAt' => Validate::int($item['clientCreatedAt'] ?? null, "items.$index.clientCreatedAt"),
            'expiresAt' => Validate::int($item['expiresAt'] ?? null, "items.$index.expiresAt"),
            'basePlacementUpdatedAt' => Validate::int($item['basePlacementUpdatedAt'] ?? null, "items.$index.basePlacementUpdatedAt"),
            'payload' => $payload + [
                'entityId' => Validate::id($payload['entityId'] ?? null, "items.$index.payload.entityId"),
                'propertyId' => Validate::id($payload['propertyId'] ?? null, "items.$index.payload.propertyId"),
                'placementId' => Validate::id($payload['placementId'] ?? null, "items.$index.payload.placementId"),
            ],
        ];
    }

    /**
     * Decides what happens to one queued item and returns what to tell the
     * device.
     *
     * @param array<string, mixed> $item
     * @return array<string, mixed>
     */
    private static function reconcile(int $userId, array $item): array
    {
        $hash = OfflineSyncRules::payloadHash($item['payload']);

        $prior = DB::table('offlineSyncReceipts')
            ->where('userId', $userId)->where('idempotencyKey', $item['idempotencyKey'])->first();

        $idempotency = OfflineSyncRules::assessIdempotency($prior->payloadHash ?? null, $hash);

        // The same key carrying different content is a bug on the device, not a
        // retry, so it is refused rather than overwriting the first submission.
        if ($idempotency === 'key_reused') {
            return [
                'idempotencyKey' => $item['idempotencyKey'],
                'status' => 'conflict',
                'code' => 'idempotency_key_reused',
                'message' => 'This submission key was already used for different content. Review and re-queue it.',
            ];
        }

        if ($prior !== null) {
            return array_filter([
                'idempotencyKey' => $item['idempotencyKey'],
                'status' => $prior->status === 'applied' ? 'already_applied' : $prior->status,
                'code' => $prior->conflictCode,
                'message' => $prior->conflictMessage,
                'resourceId' => $prior->resourceId === null ? null : (int) $prior->resourceId,
            ], static fn ($value) => $value !== null);
        }

        $capability = self::CAPABILITIES[$item['operation']] ?? self::DEFAULT_CAPABILITY;

        // Access is checked as it stands now, not as it stood when the device
        // was offline. Somebody taken off a placement yesterday does not get to
        // write to it today because they queued the note the day before.
        try {
            $guarded = Authz::assertPlacementCapability($userId, $item['payload']['placementId'], $capability);
        } catch (TrpcException $error) {
            return self::storeOutcome($userId, $item, $hash, 'rejected', 'access_changed', $error->getMessage());
        }

        $placement = $guarded['placement'];

        if ((int) $placement['entityId'] !== $item['payload']['entityId']
            || (int) ($placement['propertyId'] ?? 0) !== $item['payload']['propertyId']) {
            return self::storeOutcome(
                $userId, $item, $hash, 'conflict', 'scope_changed',
                'The placement no longer belongs to the selected entity and property.',
            );
        }

        $issue = OfflineSyncRules::assessEnvelope(
            $item['clientVersion'],
            $item['clientCreatedAt'],
            $item['expiresAt'],
            $item['basePlacementUpdatedAt'],
            self::updatedAtMillis($placement['updatedAt'] ?? null),
            (string) $placement['status'],
            Dates::nowMillis(),
        );

        if ($issue !== null) {
            return self::storeOutcome($userId, $item, $hash, 'conflict', $issue['code'], $issue['message']);
        }

        try {
            $applied = DB::transaction(static function () use ($userId, $item, $hash): array {
                $result = self::applyItem($userId, $item);

                if (isset($result['conflictCode'])) {
                    return $result;
                }

                // The receipt is written in the same transaction as the record,
                // so a retry can never apply the same item twice.
                DB::table('offlineSyncReceipts')->insert([
                    'entityId' => $item['payload']['entityId'],
                    'userId' => $userId,
                    'idempotencyKey' => $item['idempotencyKey'],
                    'operation' => $item['operation'],
                    'payloadHash' => $hash,
                    'clientCreatedAt' => $item['clientCreatedAt'],
                    'clientVersion' => $item['clientVersion'],
                    'status' => 'applied',
                    'resourceType' => $result['resourceType'],
                    'resourceId' => $result['resourceId'],
                ]);

                return $result;
            });
        } catch (Throwable $error) {
            // Two devices racing the same key: whichever lost hits the unique
            // index. If the winner stored the same content, this is a duplicate
            // rather than a failure.
            $winner = DB::table('offlineSyncReceipts')
                ->where('userId', $userId)->where('idempotencyKey', $item['idempotencyKey'])->first();

            if ($winner !== null && $winner->payloadHash === $hash) {
                return array_filter([
                    'idempotencyKey' => $item['idempotencyKey'],
                    'status' => $winner->status === 'applied' ? 'already_applied' : $winner->status,
                    'resourceId' => $winner->resourceId === null ? null : (int) $winner->resourceId,
                    'code' => $winner->conflictCode,
                    'message' => $winner->conflictMessage,
                ], static fn ($value) => $value !== null);
            }

            throw $error;
        }

        if (isset($applied['conflictCode'])) {
            return self::storeOutcome(
                $userId, $item, $hash, 'conflict', $applied['conflictCode'], $applied['conflictMessage'],
            );
        }

        Audit::write([
            'actorUserId' => $userId,
            'entityId' => $item['payload']['entityId'],
            'propertyId' => $item['payload']['propertyId'],
            'action' => 'offline_sync.applied',
            'resourceType' => $applied['resourceType'],
            'resourceId' => $applied['resourceId'],
            'sensitivity' => 'safeguarding',
            'result' => 'success',
            // clientCreatedAt is kept: the audit trail should show when the
            // worker says it happened, not only when the server heard about it.
            'metadata' => [
                'operation' => $item['operation'],
                'idempotencyKey' => $item['idempotencyKey'],
                'clientCreatedAt' => $item['clientCreatedAt'],
            ],
        ]);

        return [
            'idempotencyKey' => $item['idempotencyKey'],
            'status' => 'applied',
            'resourceId' => $applied['resourceId'],
        ];
    }

    /**
     * Writes the record the queued item describes.
     *
     * Returns either the row written, or a conflict where the world moved while
     * the device was away: a shift reassigned, a medicine withdrawn, a balance
     * or session version that no longer matches.
     *
     * @param array<string, mixed> $item
     * @return array<string, mixed>
     */
    private static function applyItem(int $userId, array $item): array
    {
        $p = $item['payload'];
        $entityId = $p['entityId'];
        $propertyId = $p['propertyId'];
        $placementId = $p['placementId'];

        switch ($item['operation']) {
            case 'key_worker_report':
                return self::written('key_worker_report', (int) DB::table('keyWorkerReports')->insertGetId([
                    'entityId' => $entityId, 'propertyId' => $propertyId, 'placementId' => $placementId,
                    'reportType' => Validate::enum($p['reportType'] ?? null, ['daily', 'weekly', 'monthly_review'], 'reportType'),
                    'reportDate' => Validate::int($p['reportDate'] ?? null, 'reportDate'),
                    'mood' => Validate::optionalString($p['mood'] ?? null, 'mood', 80),
                    'attitude' => Validate::optionalString($p['attitude'] ?? null, 'attitude', 120),
                    'learning' => Validate::optionalString($p['learning'] ?? null, 'learning', 8000),
                    'enthusiasm' => Validate::optionalString($p['enthusiasm'] ?? null, 'enthusiasm', 120),
                    'discussions' => Validate::optionalString($p['discussions'] ?? null, 'discussions', 8000),
                    'pointsToNote' => Validate::optionalString($p['pointsToNote'] ?? null, 'pointsToNote', 8000),
                    'plan' => Validate::optionalString($p['plan'] ?? null, 'plan', 8000),
                    'nextReviewAt' => Validate::optionalInt($p['nextReviewAt'] ?? null, 'nextReviewAt'),
                    'suggestions' => Validate::optionalString($p['suggestions'] ?? null, 'suggestions', 8000),
                    'status' => Validate::enum($p['status'] ?? null, ['draft', 'submitted'], 'status'),
                    'authorUserId' => $userId,
                ]));

            case 'incident':
                $category = Validate::enum($p['category'] ?? null, [
                    'safeguarding', 'missing', 'exploitation', 'police', 'abuse_allegation',
                    'child_protection_enquiry', 'restraint', 'health_safety', 'complaint', 'other',
                ], 'category');
                $severity = Validate::enum($p['severity'] ?? null, ['low', 'medium', 'high', 'critical'], 'severity');
                $review = in_array($category, self::NOTIFIABLE_INCIDENT_CATEGORIES, true) || $severity === 'critical';

                return self::written('incident', (int) DB::table('incidents')->insertGetId([
                    'entityId' => $entityId, 'propertyId' => $propertyId, 'placementId' => $placementId,
                    'category' => $category, 'severity' => $severity,
                    'occurredAt' => Validate::int($p['occurredAt'] ?? null, 'occurredAt'),
                    'summary' => Validate::string($p['summary'] ?? null, 'summary', 5, 240),
                    'details' => Validate::string($p['details'] ?? null, 'details', 20, 12000),
                    'immediateActions' => Validate::optionalString($p['immediateActions'] ?? null, 'immediateActions', 8000),
                    'createdBy' => $userId,
                    'notifiability' => $review ? 'unreviewed' : 'not_notifiable',
                    'notificationDueAt' => $review ? Dates::nowMillis() : null,
                    'status' => $review ? 'under_review' : 'open',
                ]));

            case 'clock_event':
                $shiftId = Validate::id($p['shiftId'] ?? null, 'shiftId');
                $shift = DB::table('shifts')
                    ->where('id', $shiftId)->where('propertyId', $propertyId)->where('assignedUserId', $userId)
                    ->first('id');

                if ($shift === null) {
                    return self::conflict('shift_assignment_changed', 'The shift is no longer assigned to this worker.');
                }

                $locationState = Validate::enum($p['locationState'] ?? null, ['on_site', 'off_site', 'unavailable', 'manual'], 'locationState');
                $overrideReason = Validate::optionalString($p['overrideReason'] ?? null, 'overrideReason', 2000);
                // Anything but on-site needs a reason, checked here as well as on
                // the device: a queued item did not pass through the form again.
                WorkspacePolicy::requireAttendanceOverride($locationState, $overrideReason);

                return self::written('clock_event', (int) DB::table('clockEvents')->insertGetId([
                    'entityId' => $entityId, 'propertyId' => $propertyId, 'shiftId' => $shiftId, 'userId' => $userId,
                    'eventType' => Validate::enum($p['eventType'] ?? null, ['clock_in', 'clock_out'], 'eventType'),
                    'occurredAt' => Validate::int($p['occurredAt'] ?? null, 'occurredAt'),
                    'latitude' => self::coordinate($p['latitude'] ?? null, 'latitude', 90),
                    'longitude' => self::coordinate($p['longitude'] ?? null, 'longitude', 180),
                    'accuracyMetres' => self::metres($p['accuracyMetres'] ?? null, 'accuracyMetres', 10000),
                    'distanceMetres' => self::metres($p['distanceMetres'] ?? null, 'distanceMetres', 100000),
                    'locationState' => $locationState,
                    'overrideReason' => $overrideReason,
                ]));

            case 'handover':
                return self::written('handover', (int) DB::table('handovers')->insertGetId([
                    'entityId' => $entityId, 'propertyId' => $propertyId,
                    'shiftId' => Validate::optionalId($p['shiftId'] ?? null, 'shiftId'),
                    'summary' => Validate::string($p['summary'] ?? null, 'summary', 5, 10000),
                    'risks' => Validate::optionalString($p['risks'] ?? null, 'risks', 8000),
                    'outstandingActions' => Validate::optionalString($p['outstandingActions'] ?? null, 'outstandingActions', 8000),
                    'sensitivity' => Validate::enum($p['sensitivity'] ?? 'operational', ['operational', 'safeguarding', 'restricted'], 'sensitivity'),
                    'createdBy' => $userId,
                ]));

            case 'visitor_entry':
                return self::written('property_visitor', (int) DB::table('propertyVisitors')->insertGetId([
                    'entityId' => $entityId, 'propertyId' => $propertyId, 'placementId' => $placementId,
                    'visitorType' => Validate::enum($p['visitorType'] ?? null, [
                        'friend', 'relative', 'professional', 'contractor', 'public_official', 'other',
                    ], 'visitorType'),
                    'nameCiphertext' => EncryptedFields::seal(Validate::string($p['name'] ?? null, 'name', 2, 180)),
                    'relationshipCiphertext' => EncryptedFields::seal(Validate::optionalString($p['relationship'] ?? null, 'relationship', 220)),
                    'purposeCiphertext' => EncryptedFields::seal(Validate::string($p['purpose'] ?? null, 'purpose', 2, 2000)),
                    'idCheckStatus' => Validate::enum($p['idCheckStatus'] ?? null, [
                        'not_required', 'not_checked', 'verified', 'declined', 'unavailable',
                    ], 'idCheckStatus'),
                    'identityDocumentId' => Validate::optionalId($p['identityDocumentId'] ?? null, 'identityDocumentId'),
                    'arrivedAt' => Validate::int($p['arrivedAt'] ?? null, 'arrivedAt'),
                    'expectedDepartureAt' => Validate::optionalInt($p['expectedDepartureAt'] ?? null, 'expectedDepartureAt'),
                    'notesCiphertext' => EncryptedFields::seal(Validate::optionalString($p['notes'] ?? null, 'notes', 4000)),
                    'createdBy' => $userId,
                ]));

            case 'curfew_check':
                return self::written('curfew_check', (int) DB::table('curfewChecks')->insertGetId([
                    'entityId' => $entityId, 'placementId' => $placementId,
                    'curfewPlanId' => Validate::id($p['curfewPlanId'] ?? null, 'curfewPlanId'),
                    'expectedAt' => Validate::int($p['expectedAt'] ?? null, 'expectedAt'),
                    'actualAt' => Validate::optionalInt($p['actualAt'] ?? null, 'actualAt'),
                    'status' => Validate::enum($p['status'] ?? null, [
                        'met', 'late', 'absent', 'authorised_away', 'not_applicable', 'pending',
                    ], 'status'),
                    'contactAttemptsCiphertext' => EncryptedFields::seal(Validate::optionalString($p['contactAttempts'] ?? null, 'contactAttempts', 5000)),
                    'reasonCiphertext' => EncryptedFields::seal(Validate::optionalString($p['reason'] ?? null, 'reason', 5000)),
                    'escalationRequired' => Validate::bool($p['escalationRequired'] ?? null, 'escalationRequired') ? 1 : 0,
                    'actionTakenCiphertext' => EncryptedFields::seal(Validate::optionalString($p['actionTaken'] ?? null, 'actionTaken', 5000)),
                    'createdBy' => $userId,
                ]));

            case 'missing_episode':
                return self::written('missing_episode', (int) DB::table('missingEpisodes')->insertGetId([
                    'entityId' => $entityId, 'propertyId' => $propertyId, 'placementId' => $placementId,
                    'incidentId' => Validate::optionalId($p['incidentId'] ?? null, 'incidentId'),
                    'missingAt' => Validate::int($p['missingAt'] ?? null, 'missingAt'),
                    'discoveredAt' => Validate::int($p['discoveredAt'] ?? null, 'discoveredAt'),
                    'policeContactedAt' => Validate::optionalInt($p['policeContactedAt'] ?? null, 'policeContactedAt'),
                    'policeReference' => Validate::optionalString($p['policeReference'] ?? null, 'policeReference', 120),
                    'riskLevel' => Validate::enum($p['riskLevel'] ?? null, ['low', 'medium', 'high', 'critical'], 'riskLevel'),
                    'circumstancesCiphertext' => EncryptedFields::seal(Validate::string($p['circumstances'] ?? null, 'circumstances', 10, 12000)),
                    'actionsCiphertext' => EncryptedFields::seal(Validate::string($p['actions'] ?? null, 'actions', 5, 12000)),
                    'notifications' => isset($p['notifications'])
                        ? json_encode($p['notifications'], JSON_UNESCAPED_SLASHES)
                        : null,
                    'createdBy' => $userId,
                ]));

            case 'medication_administration':
                $medicationId = Validate::id($p['medicationId'] ?? null, 'medicationId');
                $medicine = DB::table('medications')
                    ->where('id', $medicationId)->where('placementId', $placementId)->first(['id', 'nextDueAt']);

                if ($medicine === null) {
                    return self::conflict('medication_changed', 'The medication is no longer available for this placement.');
                }

                $outcome = Validate::enum($p['outcome'] ?? null, [
                    'taken', 'refused', 'omitted', 'unavailable', 'asleep', 'away', 'other',
                ], 'outcome');

                return self::written('medication_administration', (int) DB::table('medicationAdministrations')->insertGetId([
                    'entityId' => $entityId, 'placementId' => $placementId, 'medicationId' => $medicationId,
                    'scheduledAt' => $medicine->nextDueAt === null ? $item['clientCreatedAt'] : (int) $medicine->nextDueAt,
                    // The device's own time, because that is when the medicine
                    // was actually given.
                    'administeredAt' => $outcome === 'taken' ? $item['clientCreatedAt'] : null,
                    'outcome' => $outcome,
                    'doseAcknowledged' => Validate::optionalString($p['doseAcknowledged'] ?? null, 'doseAcknowledged', 120),
                    'reasonCiphertext' => EncryptedFields::seal(Validate::optionalString($p['reason'] ?? null, 'reason', 5000)),
                    'actionTakenCiphertext' => EncryptedFields::seal(Validate::optionalString($p['actionTaken'] ?? null, 'actionTaken', 5000)),
                    'escalationRequired' => Validate::bool($p['escalationRequired'] ?? null, 'escalationRequired') ? 1 : 0,
                    'createdBy' => $userId,
                ]));

            case 'property_check':
                return self::written('property_check', (int) DB::table('propertyChecks')->insertGetId([
                    'entityId' => $entityId, 'propertyId' => $propertyId,
                    'unitId' => Validate::optionalId($p['unitId'] ?? null, 'unitId'),
                    'placementId' => $placementId,
                    'shiftId' => Validate::optionalId($p['shiftId'] ?? null, 'shiftId'),
                    'checkType' => Validate::enum($p['checkType'] ?? null, [
                        'room_check', 'property_check', 'fire_check', 'night_check', 'health_safety', 'welfare', 'other',
                    ], 'checkType'),
                    'authorityBasis' => Validate::enum($p['authorityBasis'] ?? null, [
                        'scheduled', 'consent', 'risk_assessment', 'emergency', 'policy', 'other',
                    ], 'authorityBasis'),
                    'checklistSnapshot' => json_encode(self::checklist($p['checklist'] ?? null), JSON_UNESCAPED_SLASHES),
                    'findingsCiphertext' => EncryptedFields::seal(Validate::optionalString($p['findings'] ?? null, 'findings', 6000)),
                    'privacyNotesCiphertext' => EncryptedFields::seal(Validate::optionalString($p['privacyNotes'] ?? null, 'privacyNotes', 4000)),
                    'youngPersonPresent' => Validate::bool($p['youngPersonPresent'] ?? null, 'youngPersonPresent') ? 1 : 0,
                    'result' => Validate::enum($p['result'] ?? null, ['pass', 'issues_found', 'urgent_action'], 'result'),
                    'status' => 'submitted',
                    'completedAt' => $item['clientCreatedAt'],
                    'createdBy' => $userId,
                ]));

            case 'maintenance_job':
                return self::written('maintenance_job', (int) DB::table('maintenanceJobs')->insertGetId([
                    'entityId' => $entityId, 'propertyId' => $propertyId,
                    'unitId' => Validate::optionalId($p['unitId'] ?? null, 'unitId'),
                    'propertyCheckId' => Validate::optionalId($p['propertyCheckId'] ?? null, 'propertyCheckId'),
                    'incidentId' => Validate::optionalId($p['incidentId'] ?? null, 'incidentId'),
                    'title' => Validate::string($p['title'] ?? null, 'title', 3, 220),
                    'category' => Validate::enum($p['category'] ?? null, [
                        'plumbing', 'electrical', 'heating', 'fire_safety', 'security',
                        'furniture', 'appliance', 'fabric', 'pest', 'cleaning', 'other',
                    ], 'category'),
                    'priority' => Validate::enum($p['priority'] ?? null, ['routine', 'urgent', 'emergency'], 'priority'),
                    'descriptionCiphertext' => EncryptedFields::seal(Validate::string($p['description'] ?? null, 'description', 5, 6000)),
                    'accessNotesCiphertext' => EncryptedFields::seal(Validate::optionalString($p['accessNotes'] ?? null, 'accessNotes', 4000)),
                    'targetAt' => Validate::optionalInt($p['targetAt'] ?? null, 'targetAt'),
                    'createdBy' => $userId,
                ]));

            case 'resident_finance_transaction':
                return self::applyFinance($userId, $p);

            default:
                return self::applyLoneWorkerCheckIn($userId, $p);
        }
    }

    /**
     * A young person's own money. The account version has to be the one the
     * device saw, and the balance may not go below zero.
     *
     * @param array<string, mixed> $p
     * @return array<string, mixed>
     */
    private static function applyFinance(int $userId, array $p): array
    {
        $accountId = Validate::id($p['accountId'] ?? null, 'accountId');
        $expectedVersion = Validate::id($p['expectedAccountVersion'] ?? null, 'expectedAccountVersion');

        $account = DB::table('residentFinanceAccounts')
            ->where('id', $accountId)->where('placementId', $p['placementId'])
            ->first(['id', 'balance', 'version']);

        if ($account === null || (int) $account->version !== $expectedVersion) {
            return self::conflict(
                'account_version_changed',
                'The resident balance changed while this item was offline. Review the account before resubmitting.',
            );
        }

        $transactionType = Validate::enum($p['transactionType'] ?? null, [
            'deposit', 'withdrawal', 'purchase', 'refund', 'adjustment', 'reversal',
        ], 'transactionType');
        $amount = Validate::decimal($p['amount'] ?? null, 'amount', 0.01, 1000000);

        $nextBalance = (float) $account->balance + WorkspacePolicy::signedAmount($transactionType, $amount);

        if ($nextBalance < 0) {
            return self::conflict('negative_balance', 'The transaction would make the resident account negative.');
        }

        $id = (int) DB::table('residentFinanceTransactions')->insertGetId([
            'entityId' => $p['entityId'], 'placementId' => $p['placementId'], 'accountId' => $accountId,
            'transactionType' => $transactionType,
            'amount' => number_format($amount, 2, '.', ''),
            'balanceAfter' => number_format($nextBalance, 2, '.', ''),
            'purposeCiphertext' => EncryptedFields::seal(Validate::string($p['purpose'] ?? null, 'purpose', 2, 5000)),
            'counterpartyCiphertext' => EncryptedFields::seal(Validate::optionalString($p['counterparty'] ?? null, 'counterparty', 2000)),
            'receiptDocumentId' => Validate::optionalId($p['receiptDocumentId'] ?? null, 'receiptDocumentId'),
            'occurredAt' => Validate::int($p['occurredAt'] ?? null, 'occurredAt'),
            'createdBy' => $userId,
        ]);

        DB::table('residentFinanceAccounts')->where('id', $account->id)->update([
            'balance' => number_format($nextBalance, 2, '.', ''),
            'version' => (int) $account->version + 1,
        ]);

        return self::written('resident_finance_transaction', $id);
    }

    /**
     * A lone worker's check-in. It also moves the session on, which is why the
     * device has to have been looking at the version it is writing against.
     *
     * @param array<string, mixed> $p
     * @return array<string, mixed>
     */
    private static function applyLoneWorkerCheckIn(int $userId, array $p): array
    {
        $sessionId = Validate::id($p['sessionId'] ?? null, 'sessionId');
        $expectedVersion = Validate::id($p['expectedSessionVersion'] ?? null, 'expectedSessionVersion');

        $session = DB::table('loneWorkerSessions')
            ->where('id', $sessionId)->where('userId', $userId)->first();

        if ($session === null || (int) $session->version !== $expectedVersion) {
            return self::conflict('session_version_changed', 'The lone-worker session changed while this item was offline.');
        }

        $checkInType = Validate::enum($p['checkInType'] ?? null, [
            'scheduled', 'manual', 'help_requested', 'session_end',
        ], 'checkInType');
        $wellbeingStatus = Validate::enum($p['wellbeingStatus'] ?? null, ['safe', 'concern', 'help_required'], 'wellbeingStatus');
        $occurredAt = Validate::int($p['occurredAt'] ?? null, 'occurredAt');

        $id = (int) DB::table('loneWorkerCheckIns')->insertGetId([
            'entityId' => $p['entityId'], 'sessionId' => $sessionId,
            'checkInType' => $checkInType,
            'wellbeingStatus' => $wellbeingStatus,
            'occurredAt' => $occurredAt,
            'latitude' => self::coordinate($p['latitude'] ?? null, 'latitude', 90),
            'longitude' => self::coordinate($p['longitude'] ?? null, 'longitude', 180),
            'accuracyMetres' => self::metres($p['accuracyMetres'] ?? null, 'accuracyMetres', 10000),
            'locationState' => Validate::enum($p['locationState'] ?? null, ['on_site', 'off_site', 'unavailable', 'manual'], 'locationState'),
            'noteCiphertext' => EncryptedFields::seal(Validate::optionalString($p['note'] ?? null, 'note', 4000)),
            'createdBy' => $userId,
        ]);

        // A request for help escalates the session even though it arrived late:
        // somebody still needs to know it was asked for.
        DB::table('loneWorkerSessions')->where('id', $session->id)->update([
            'lastCheckInAt' => $occurredAt,
            'nextCheckInDueAt' => $occurredAt + (int) $session->checkInIntervalMinutes * 60000,
            'status' => match (true) {
                $checkInType === 'session_end' => 'completed',
                $wellbeingStatus === 'help_required' => 'escalated',
                default => 'active',
            },
            'completedAt' => $checkInType === 'session_end' ? $occurredAt : $session->completedAt,
            'escalatedAt' => $wellbeingStatus === 'help_required' ? $occurredAt : $session->escalatedAt,
            'version' => (int) $session->version + 1,
        ]);

        return self::written('lone_worker_check_in', $id);
    }

    /**
     * Records why an item was not applied, so the device can show the worker
     * rather than losing the entry.
     *
     * @param array<string, mixed> $item
     * @return array<string, mixed>
     */
    private static function storeOutcome(int $userId, array $item, string $hash, string $status, string $code, string $message): array
    {
        DB::table('offlineSyncReceipts')->insert([
            'entityId' => $item['payload']['entityId'],
            'userId' => $userId,
            'idempotencyKey' => $item['idempotencyKey'],
            'operation' => $item['operation'],
            'payloadHash' => $hash,
            'clientCreatedAt' => $item['clientCreatedAt'],
            'clientVersion' => $item['clientVersion'],
            'status' => $status,
            'conflictCode' => $code,
            'conflictMessage' => $message,
        ]);

        return [
            'idempotencyKey' => $item['idempotencyKey'],
            'status' => $status,
            'code' => $code,
            'message' => $message,
        ];
    }

    /** @return array{resourceType: string, resourceId: int} */
    private static function written(string $resourceType, int $resourceId): array
    {
        return ['resourceType' => $resourceType, 'resourceId' => $resourceId];
    }

    /** @return array{conflictCode: string, conflictMessage: string} */
    private static function conflict(string $code, string $message): array
    {
        return ['conflictCode' => $code, 'conflictMessage' => $message];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private static function checklist(mixed $value): array
    {
        $rows = Validate::arrayOf($value, 'checklist', 100);
        if ($rows === []) {
            throw TrpcException::badRequest('A property check needs at least one checklist entry.');
        }

        $clean = [];
        foreach ($rows as $index => $row) {
            $row = Validate::object($row, "checklist.$index");
            $clean[] = [
                'key' => Validate::string($row['key'] ?? null, "checklist.$index.key", 1, 80),
                'label' => Validate::string($row['label'] ?? null, "checklist.$index.label", 1, 180),
                'result' => Validate::enum($row['result'] ?? null, ['pass', 'fail', 'not_applicable'], "checklist.$index.result"),
                'note' => Validate::optionalString($row['note'] ?? null, "checklist.$index.note", 1000),
            ];
        }

        return $clean;
    }

    /** A latitude or longitude as the DECIMAL column stores it. */
    private static function coordinate(mixed $value, string $field, float $bound): ?string
    {
        return $value === null ? null : (string) Validate::decimal($value, $field, -$bound, $bound);
    }

    private static function metres(mixed $value, string $field, float $max): ?string
    {
        return $value === null ? null : (string) Validate::decimal($value, $field, 0, $max);
    }

    /**
     * placements.updatedAt is a MySQL timestamp rather than a millisecond
     * column, so it is converted here for the envelope comparison.
     */
    private static function updatedAtMillis(mixed $value): int
    {
        if (is_int($value)) {
            return $value;
        }

        $date = Dates::fromDatabase($value);

        return $date === null ? 0 : (int) ($date->getTimestamp() * 1000);
    }
}
