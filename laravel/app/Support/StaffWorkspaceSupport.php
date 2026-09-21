<?php

declare(strict_types=1);

namespace App\Support;

use App\Trpc\TrpcException;
use Illuminate\Support\Facades\DB;

/**
 * Shared machinery for the staff workspace procedures, mirroring the helpers at
 * the top of server/routers/staffWorkspace.ts.
 */
final class StaffWorkspaceSupport
{
    /**
     * A shift may be acted on by a manager, or by the worker it is assigned to,
     * and only while they hold the live-shift property permission.
     *
     * @return array{shift: array<string, mixed>, access: array<string, mixed>}
     */
    public static function assertShiftActor(int $userId, int $shiftId): array
    {
        $shift = DB::table('shifts')->where('id', $shiftId)->first();
        if ($shift === null) {
            throw TrpcException::notFound('Shift not found');
        }

        $shift = (array) $shift;

        $access = Authz::assertCurrentShiftPropertyCapability(
            $userId,
            (int) $shift['entityId'],
            (int) $shift['propertyId'],
            'frontline.write',
        );

        if (!WorkspacePolicy::isManagerRole($access['role'] ?? null)
            && (int) ($shift['assignedUserId'] ?? 0) !== $userId) {
            throw TrpcException::forbidden('This shift is not assigned to you');
        }

        return ['shift' => $shift, 'access' => $access];
    }

    /**
     * Raises an alert with every registered manager in the company.
     *
     * Two things are deliberate. The stored preview carries a category and a
     * building and nothing else, because a push or SMS can appear on a lock
     * screen. And a channel with no connected provider is recorded as
     * provider_inactive rather than delivered, so an urgent alert that never
     * left the building is visible as such afterwards.
     */
    public static function notifyManagers(
        int $entityId,
        ?int $propertyId,
        string $resourceType,
        int $resourceId,
        string $category,
        bool $urgent,
        string $deepLink,
    ): void {
        $managers = DB::table('entityMemberships')
            ->where('entityId', $entityId)
            ->where('status', 'active')
            ->where('operationalRole', 'registered_manager')
            ->pluck('userId')->all();

        if ($managers === []) {
            return;
        }

        $propertyName = $propertyId === null
            ? null
            : DB::table('properties')->where('id', $propertyId)->value('name');

        $preview = WorkspacePolicy::safeNotificationPreview($category, $propertyName, $urgent);

        $connections = DB::table('integrationConnections')
            ->where('entityId', $entityId)
            ->where('status', 'active')
            ->whereIn('integrationType', ['email', 'sms'])
            ->get();

        $emailConnection = $connections->firstWhere('integrationType', 'email');
        $smsConnection = $connections->firstWhere('integrationType', 'sms');

        $channels = WorkspacePolicy::notificationChannels(
            $urgent,
            $emailConnection !== null,
            $smsConnection !== null,
        );

        $now = Dates::nowMillis();
        $type = str_replace(' ', '_', strtolower($category));

        foreach ($managers as $managerId) {
            $dedupeKey = "$resourceType:$resourceId:$managerId";

            // Upserted on the dedupe key so a repeated alert reopens the existing
            // one rather than burying the manager in duplicates.
            DB::table('notifications')->upsert([[
                'entityId' => $entityId,
                'userId' => $managerId,
                'type' => $type,
                'title' => $preview['title'],
                'message' => $preview['body'],
                'severity' => $urgent ? 'urgent' : 'warning',
                'resourceType' => $resourceType,
                'resourceId' => $resourceId,
                'deepLink' => $deepLink,
                'acknowledgementRequired' => 1,
                'escalationDueAt' => $urgent ? $now + 900000 : null,
                'dedupeKey' => $dedupeKey,
            ]], ['dedupeKey'], ['title', 'message', 'severity', 'resolvedAt']);

            $notificationId = DB::table('notifications')
                ->where('userId', $managerId)->where('dedupeKey', $dedupeKey)->value('id');

            $deliveries = [
                ['channel' => 'push', 'status' => 'delivered', 'connectionId' => null, 'deliveredAt' => $now],
            ];

            if ($urgent) {
                $deliveries[] = [
                    'channel' => 'email',
                    'status' => $emailConnection !== null ? 'queued' : 'provider_inactive',
                    'connectionId' => $emailConnection->id ?? null,
                    'deliveredAt' => null,
                ];
                $deliveries[] = [
                    'channel' => 'sms',
                    'status' => $smsConnection !== null ? 'queued' : 'provider_inactive',
                    'connectionId' => $smsConnection->id ?? null,
                    'deliveredAt' => null,
                ];
            }

            foreach ($deliveries as $delivery) {
                DB::table('notificationChannelDeliveries')->upsert([[
                    'entityId' => $entityId,
                    'notificationId' => $notificationId,
                    'userId' => $managerId,
                    'channel' => $delivery['channel'],
                    'status' => $delivery['status'],
                    'providerConnectionId' => $delivery['connectionId'],
                    'idempotencyKey' => $dedupeKey . ':' . $delivery['channel'],
                    'payloadSnapshot' => json_encode([
                        'title' => $preview['title'],
                        'body' => $preview['body'],
                        'deepLink' => $deepLink,
                        'containsSensitiveDetails' => false,
                    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                    'deliveredAt' => $delivery['deliveredAt'],
                ]], ['idempotencyKey'], ['status', 'providerConnectionId', 'lastError']);
            }
        }

        Audit::write([
            'entityId' => $entityId,
            'propertyId' => $propertyId,
            'actorType' => 'system',
            'action' => 'notification.enqueue',
            'resourceType' => $resourceType,
            'resourceId' => $resourceId,
            'result' => 'success',
            'metadata' => $channels,
        ]);
    }

    /** The person type a presence event records for a given visitor type. */
    public static function presencePersonType(string $visitorType): string
    {
        return match ($visitorType) {
            'contractor' => 'contractor',
            'professional', 'public_official' => 'professional',
            default => 'visitor',
        };
    }

    /**
     * Confirms the record a piece of workspace evidence is being attached to
     * exists, and that the caller may write to it. Evidence inherits the
     * permission of its parent, so this is what stops a document being pinned to
     * a record the caller cannot otherwise reach.
     */
    public static function assertEvidenceParent(int $userId, int $entityId, string $resourceType, string $resourceId): void
    {
        if (!ctype_digit($resourceId) || (int) $resourceId <= 0) {
            throw WorkspacePolicy::fieldError('resource_id_invalid', 'resourceId', 'Choose a valid parent record.');
        }
        $parsedId = (int) $resourceId;

        $propertyScoped = [
            'incident' => ['incidents', 'incident.write'],
            'property_visitor' => ['propertyVisitors', 'frontline.write'],
            'property_check' => ['propertyChecks', 'frontline.write'],
            'maintenance_job' => ['maintenanceJobs', 'frontline.write'],
        ];

        if (isset($propertyScoped[$resourceType])) {
            [$table, $capability] = $propertyScoped[$resourceType];
            $row = DB::table($table)->where('id', $parsedId)->where('entityId', $entityId)->first(['entityId', 'propertyId']);
            if ($row === null) {
                throw TrpcException::notFound('Parent record not found');
            }
            Authz::assertCurrentShiftPropertyCapability($userId, $entityId, (int) $row->propertyId, $capability);

            return;
        }

        $placementScoped = [
            'key_worker_report' => ['keyWorkerReports', 'young_person.write'],
            'keywork_session' => ['keyworkSessions', 'young_person.write'],
            'daily_note' => ['dailyNotes', 'young_person.write'],
            'medication_discrepancy' => ['medicationDiscrepancies', 'medication.write'],
            'resident_finance_transaction' => ['residentFinanceTransactions', 'resident_finance.write'],
        ];

        if (isset($placementScoped[$resourceType])) {
            [$table, $capability] = $placementScoped[$resourceType];
            $row = DB::table($table)->where('id', $parsedId)->where('entityId', $entityId)->first(['entityId', 'placementId']);
            if ($row === null) {
                throw TrpcException::notFound('Parent record not found');
            }
            Authz::assertCurrentShiftPlacementCapability($userId, (int) $row->placementId, $capability);

            return;
        }

        if ($resourceType === 'staff_request') {
            $row = DB::table('staffRequests')->where('id', $parsedId)->where('entityId', $entityId)->first();
            if ($row === null) {
                throw TrpcException::notFound('Parent record not found');
            }

            // Your own request needs self-service; somebody else's needs a
            // manager.
            if ((int) $row->userId !== $userId) {
                WorkspaceGuards::assertManager($userId, $entityId);
            } else {
                Authz::assertEntityCapability($userId, $entityId, 'staff.self_service');
            }

            return;
        }

        throw WorkspacePolicy::fieldError(
            'resource_type_unsupported',
            'resourceType',
            'This record type cannot receive workspace evidence.',
        );
    }
}
