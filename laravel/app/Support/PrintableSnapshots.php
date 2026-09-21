<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * The factual snapshots behind a printable record, mirroring
 * server/services/printableRecordExportSnapshots.ts.
 *
 * A snapshot is what the PDF is rendered from and what the SHA-256 on its
 * front page is taken over, so the shape has to be stable: the same records
 * over the same range must always produce the same bytes. That is why the
 * key order below follows the Node builders exactly, down to which keys are
 * present — a snapshot hashed here has to equal one hashed there, or a
 * request raised before the port could never be approved after it.
 */
final class PrintableSnapshots
{
    /**
     * The hash on the record's front page and in its audit trail.
     *
     * @param array<string, mixed> $snapshot
     */
    public static function hash(array $snapshot): string
    {
        return hash('sha256', json_encode(
            $snapshot,
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR,
        ));
    }

    /** @return array<string, mixed> */
    public static function youngPerson(int $entityId, int $placementId, int $rangeStart, int $rangeEnd, string $entityName): array
    {
        $context = DB::table('placements as pl')
            ->join('youngPeople as y', 'y.id', '=', 'pl.youngPersonId')
            ->leftJoin('properties as pr', 'pr.id', '=', 'pl.propertyId')
            ->where('pl.id', $placementId)->where('pl.entityId', $entityId)
            ->first(['pr.name as propertyName', 'y.reference', 'y.preferredName']);

        if ($context === null) {
            throw new RuntimeException('Placement not found');
        }

        $inRange = static fn (string $table, string $column) => DB::table($table)
            ->where('placementId', $placementId)
            ->where($column, '>=', $rangeStart)->where($column, '<=', $rangeEnd)
            ->orderByDesc($column);

        $healthPlans = DB::table('healthMonitoringPlans')->where('placementId', $placementId)->get(['id', 'title']);
        $medicines = DB::table('medications')->where('placementId', $placementId)->get(['id', 'name']);
        $curfewPlans = DB::table('curfewPlans')->where('placementId', $placementId)->get(['id', 'expectedReturnTime']);

        $planTitles = $healthPlans->pluck('title', 'id')->all();
        $medicineNames = $medicines->pluck('name', 'id')->all();
        $curfewTimes = $curfewPlans->pluck('expectedReturnTime', 'id')->all();

        $activities = $inRange('scheduledActivities', 'scheduledStart')->get()->all();
        $curfewChecks = $inRange('curfewChecks', 'expectedAt')->get()->all();
        $administrations = $inRange('medicationAdministrations', 'scheduledAt')->get()->all();
        $healthEvents = $inRange('healthMonitoringEvents', 'occurredAt')->get()->all();

        // professionalContacts and keyWorkerReports are filtered on a timestamp
        // column, so the range is compared as a datetime rather than millis.
        $contacts = DB::table('professionalContacts')
            ->where('placementId', $placementId)
            ->where('createdAt', '>=', self::sqlTime($rangeStart))
            ->where('createdAt', '<=', self::sqlTime($rangeEnd))
            ->orderByDesc('createdAt')
            ->get([
                'id', 'contactType', 'name', 'roleTitle', 'organisation',
                'preferredContactMethod', 'isPrimary', 'status', 'createdAt',
            ])->all();

        $reports = DB::table('keyWorkerReports as k')
            ->join('users as u', 'u.id', '=', 'k.authorUserId')
            ->where('k.placementId', $placementId)
            ->where('k.reportDate', '>=', $rangeStart)->where('k.reportDate', '<=', $rangeEnd)
            ->orderByDesc('k.reportDate')
            ->get([
                'k.reportType', 'k.reportDate', 'k.mood', 'k.attitude', 'k.learning', 'k.enthusiasm',
                'k.discussions', 'k.pointsToNote', 'k.plan', 'k.suggestions', 'k.status', 'k.approvedAt',
                'u.name as authorName',
            ])->all();

        $incidents = DB::table('incidents')
            ->where('entityId', $entityId)->where('placementId', $placementId)
            ->where('occurredAt', '>=', $rangeStart)->where('occurredAt', '<=', $rangeEnd)
            ->orderByDesc('occurredAt')
            ->get([
                'occurredAt', 'category', 'severity', 'summary', 'details',
                'immediateActions', 'status', 'managerReviewState',
            ])->all();

        $sections = [
            self::section('College, court and appointments', array_map(static fn ($row) => [
                'occurredAt' => (int) $row->scheduledStart,
                'title' => self::titleCase($row->activityType) . ' · ' . $row->title,
                'detail' => self::join(' · ', [
                    self::clean($row->organisation),
                    'Attendance: ' . self::titleCase($row->attendanceStatus),
                    self::clean($row->transport) === null ? null : 'Travel: ' . self::titleCase($row->transport),
                ]),
                'notes' => self::join("\n", [
                    self::clean(Crypto::decrypt($row->outcomeCiphertext)),
                    self::clean(Crypto::decrypt($row->followUpCiphertext)),
                ]),
                'status' => $row->acknowledgedAt !== null ? 'acknowledged' : $row->attendanceStatus,
            ], $activities)),

            self::section('Curfew', array_map(static fn ($row) => [
                'occurredAt' => (int) ($row->actualAt ?? $row->expectedAt),
                'title' => 'Expected return ' . ($curfewTimes[$row->curfewPlanId] ?? 'time'),
                'detail' => self::join(' · ', [
                    self::titleCase($row->status),
                    $row->escalationRequired ? 'Escalation required' : null,
                ]),
                'notes' => self::join("\n", [
                    self::clean(Crypto::decrypt($row->contactAttemptsCiphertext)),
                    self::clean(Crypto::decrypt($row->reasonCiphertext)),
                    self::clean(Crypto::decrypt($row->actionTakenCiphertext)),
                ]),
                'status' => $row->acknowledgedAt !== null ? 'acknowledged' : $row->status,
            ], $curfewChecks)),

            self::section('Professional contacts', array_map(static fn ($row) => [
                'occurredAt' => self::millis($row->createdAt),
                'title' => self::titleCase($row->contactType) . ' · ' . $row->name,
                'detail' => self::join(' · ', [
                    self::clean($row->roleTitle),
                    self::clean($row->organisation),
                    'Preferred method: ' . self::titleCase($row->preferredContactMethod),
                    $row->isPrimary ? 'Primary contact' : null,
                ]),
                'status' => $row->status,
            ], $contacts)),

            self::section('Medication', array_map(static fn ($row) => [
                'occurredAt' => (int) ($row->administeredAt ?? $row->scheduledAt),
                'title' => $medicineNames[$row->medicationId] ?? 'Medication',
                'detail' => self::join(' · ', [
                    'Outcome: ' . self::titleCase($row->outcome),
                    self::clean((string) $row->doseAcknowledged) === null ? null : 'Dose: ' . $row->doseAcknowledged,
                    $row->managerAcknowledgedAt !== null ? 'Manager acknowledged' : null,
                    $row->escalationRequired ? 'Escalation required' : null,
                ]),
                'notes' => self::join("\n", [
                    self::clean(Crypto::decrypt($row->reasonCiphertext)),
                    self::clean(Crypto::decrypt($row->actionTakenCiphertext)),
                ]),
                'status' => $row->managerAcknowledgedAt !== null ? 'acknowledged' : $row->outcome,
            ], $administrations)),

            self::section('Health monitoring', array_map(static fn ($row) => [
                'occurredAt' => (int) $row->occurredAt,
                'title' => $planTitles[$row->planId] ?? 'Health observation',
                'detail' => self::join(' · ', [
                    self::titleCase($row->outcome),
                    self::clean((string) $row->value) === null ? null : $row->value . ($row->unit ? " $row->unit" : ''),
                    $row->escalationRequired ? 'Escalation required' : null,
                ]),
                'notes' => self::clean(Crypto::decrypt($row->notesCiphertext)),
                'status' => $row->acknowledgedAt !== null ? 'acknowledged' : $row->outcome,
            ], $healthEvents)),

            self::section('Keyworker reports', array_map(static fn ($row) => [
                'occurredAt' => (int) $row->reportDate,
                'title' => self::titleCase($row->reportType) . ' · ' . ($row->authorName ?? 'Key Worker'),
                'detail' => self::join(' · ', [
                    'Status: ' . self::titleCase($row->status),
                    $row->approvedAt === null ? null : 'Previously approved ' . self::shortDate((int) $row->approvedAt),
                ]),
                'notes' => self::reportNotes($row),
                'status' => $row->status,
            ], $reports)),

            self::section('Incidents and significant events', array_map(static fn ($row) => [
                'occurredAt' => (int) $row->occurredAt,
                'title' => self::titleCase($row->category) . ' · ' . $row->summary,
                'detail' => self::join(' · ', [
                    'Severity: ' . self::titleCase($row->severity),
                    'Review: ' . self::titleCase($row->managerReviewState),
                    'Status: ' . self::titleCase($row->status),
                ]),
                'notes' => self::join("\n", [self::clean($row->details), self::clean($row->immediateActions)]),
                'status' => $row->managerReviewState,
            ], $incidents)),
        ];

        $sourceCounts = [
            'activities' => count($activities),
            'curfewChecks' => count($curfewChecks),
            'professionalContacts' => count($contacts),
            'medicationAdministrations' => count($administrations),
            'healthMonitoringEvents' => count($healthEvents),
            'keyWorkerReports' => count($reports),
            'incidents' => count($incidents),
        ];

        return [
            'type' => 'young_person_compilation',
            'entityName' => $entityName,
            'propertyName' => $context->propertyName,
            'placementReference' => $context->reference,
            'preferredName' => $context->preferredName,
            'recordCount' => array_sum($sourceCounts),
            'sourceCounts' => $sourceCounts,
            'sections' => $sections,
        ];
    }

    /**
     * @param array<int, int> $propertyIds
     * @return array<string, mixed>
     */
    public static function shiftRegister(int $entityId, array $propertyIds, ?string $propertyName, int $rangeStart, int $rangeEnd, string $entityName, bool $includeSensitiveHandover): array
    {
        $shifts = DB::table('shifts as s')
            ->join('properties as p', 'p.id', '=', 's.propertyId')
            ->leftJoin('users as u', 'u.id', '=', 's.assignedUserId')
            ->where('s.entityId', $entityId)->whereIn('s.propertyId', $propertyIds)
            ->where('s.startsAt', '>=', $rangeStart)->where('s.startsAt', '<=', $rangeEnd)
            ->orderByDesc('s.startsAt')
            ->get([
                's.title', 's.startsAt', 's.endsAt', 's.requiredRole', 's.status', 's.coverageState',
                'p.name as propertyName', 'u.name as workerName',
            ])->all();

        $clockEvents = DB::table('clockEvents as c')
            ->join('properties as p', 'p.id', '=', 'c.propertyId')
            ->join('users as u', 'u.id', '=', 'c.userId')
            ->where('c.entityId', $entityId)->whereIn('c.propertyId', $propertyIds)
            ->where('c.occurredAt', '>=', $rangeStart)->where('c.occurredAt', '<=', $rangeEnd)
            ->orderByDesc('c.occurredAt')
            ->get(['c.occurredAt', 'c.eventType', 'c.locationState', 'p.name as propertyName', 'u.name as workerName'])->all();

        $handoverRows = DB::table('handovers as h')
            ->join('properties as p', 'p.id', '=', 'h.propertyId')
            ->join('users as u', 'u.id', '=', 'h.createdBy')
            ->where('h.entityId', $entityId)->whereIn('h.propertyId', $propertyIds)
            ->where('h.createdAt', '>=', self::sqlTime($rangeStart))
            ->where('h.createdAt', '<=', self::sqlTime($rangeEnd))
            ->orderByDesc('h.createdAt')
            ->get([
                'h.createdAt', 'h.summary', 'h.risks', 'h.outstandingActions', 'h.sensitivity',
                'h.dictatedReviewState as reviewState', 'p.name as propertyName', 'u.name as authorName',
            ])->all();

        // A safeguarding handover is left out unless the requester is a manager:
        // a shift register is an attendance record, not a route to care notes.
        $handovers = $includeSensitiveHandover
            ? $handoverRows
            : array_values(array_filter($handoverRows, static fn ($row) => $row->sensitivity === 'operational'));

        $sourceCounts = [
            'shifts' => count($shifts),
            'clockEvents' => count($clockEvents),
            'handovers' => count($handovers),
        ];

        return [
            'type' => 'shift_register',
            'entityName' => $entityName,
            'propertyName' => $propertyName,
            'recordCount' => array_sum($sourceCounts),
            'sourceCounts' => $sourceCounts,
            'sections' => [
                self::section('Planned and worked shifts', array_map(static fn ($row) => [
                    'occurredAt' => (int) $row->startsAt,
                    'title' => $row->propertyName . ' · ' . $row->title,
                    'detail' => self::join(' · ', [
                        'Ends ' . self::longDate((int) $row->endsAt) . ' UTC',
                        $row->workerName ? 'Worker: ' . $row->workerName : 'Unassigned',
                        'Status: ' . self::titleCase($row->status),
                        'Coverage: ' . self::titleCase($row->coverageState),
                        self::clean($row->requiredRole) === null ? null : 'Required: ' . $row->requiredRole,
                    ]),
                    'status' => $row->status,
                ], $shifts)),

                self::section('Clock evidence', array_map(static fn ($row) => [
                    'occurredAt' => (int) $row->occurredAt,
                    'title' => $row->propertyName . ' · ' . self::titleCase($row->eventType),
                    'detail' => ($row->workerName ?? 'Worker') . ' · Location: ' . self::titleCase($row->locationState),
                    'status' => $row->locationState,
                ], $clockEvents)),

                self::section('Shift handovers', array_map(static fn ($row) => [
                    'occurredAt' => self::millis($row->createdAt),
                    'title' => $row->propertyName . ' · ' . ($row->authorName ?? 'Worker'),
                    'detail' => self::titleCase($row->sensitivity) . ' · Dictation review: ' . self::titleCase($row->reviewState),
                    'notes' => self::join("\n", [
                        self::clean($row->summary),
                        self::clean($row->risks) === null ? null : 'Risks: ' . $row->risks,
                        self::clean($row->outstandingActions) === null ? null : 'Outstanding actions: ' . $row->outstandingActions,
                    ]),
                    'status' => $row->reviewState,
                ], $handovers)),
            ],
        ];
    }

    /** @return array<string, mixed> */
    public static function timesheet(int $timesheetId, string $entityName, string $workerName, ?int $approvedAt): array
    {
        $rows = DB::table('timesheetEntries')->where('timesheetId', $timesheetId)->get()->all();

        return [
            'type' => 'timesheet',
            'entityName' => $entityName,
            'propertyName' => 'Approved workforce record',
            'recordCount' => count($rows),
            'sourceCounts' => ['timesheetEntries' => count($rows)],
            'sections' => [
                self::section('Clock-derived timesheet entries', array_map(static fn ($row) => [
                    'title' => $row->minutes . ' minutes',
                    'detail' => self::join(' · ', [
                        "Worker: $workerName",
                        'Exception: ' . self::titleCase($row->exceptionType),
                        $row->originalMinutes === null ? null : 'Original: ' . $row->originalMinutes . ' minutes',
                        $approvedAt === null ? null : 'Approved ' . self::shortDate($approvedAt),
                    ]),
                    'status' => $row->exceptionType,
                ], $rows)),
            ],
        ];
    }

    /**
     * @param array<int, int> $propertyIds
     * @return array<string, mixed>
     */
    public static function documentRegister(int $entityId, array $propertyIds, ?string $propertyName, int $rangeStart, int $rangeEnd, string $entityName): array
    {
        $query = DB::table('documents as d')
            ->leftJoin('properties as p', 'p.id', '=', 'd.propertyId')
            ->leftJoin('documentVersions as v', static function ($join): void {
                $join->on('v.documentId', '=', 'd.id')->on('v.version', '=', 'd.currentVersion');
            })
            ->where('d.entityId', $entityId)
            ->where('d.createdAt', '>=', self::sqlTime($rangeStart))
            ->where('d.createdAt', '<=', self::sqlTime($rangeEnd))
            ->orderByDesc('d.createdAt');

        // An entity-level document belongs to every authorised property view.
        $query->where(static function ($where) use ($propertyIds): void {
            $where->whereNull('d.propertyId');
            if ($propertyIds !== []) {
                $where->orWhereIn('d.propertyId', $propertyIds);
            }
        });

        $rows = $query->get([
            'd.title', 'd.documentType', 'd.classification', 'd.status', 'd.currentVersion',
            'd.reviewDueAt', 'd.retentionUntil', 'p.name as propertyName', 'v.fileName', 'v.contentHash',
        ])->all();

        return [
            'type' => 'document_register',
            'entityName' => $entityName,
            'propertyName' => $propertyName,
            'recordCount' => count($rows),
            'sourceCounts' => ['documents' => count($rows)],
            'sections' => [
                self::section('Controlled document index', array_map(static fn ($row) => [
                    'title' => $row->title,
                    'detail' => self::join(' · ', [
                        ($row->propertyName ?? 'Entity-level') . ' · ' . self::titleCase($row->documentType),
                        'Classification: ' . self::titleCase($row->classification),
                        'Status: ' . self::titleCase($row->status),
                        'Version ' . $row->currentVersion,
                        $row->fileName ? 'Stored file: ' . $row->fileName : 'No file version',
                        $row->reviewDueAt === null ? null : 'Review due ' . self::shortDate((int) $row->reviewDueAt),
                        $row->retentionUntil === null ? null : 'Retain until ' . self::shortDate((int) $row->retentionUntil),
                        $row->contentHash === null ? null : 'SHA-256: ' . $row->contentHash,
                    ]),
                    'status' => $row->status,
                ], $rows)),
            ],
        ];
    }

    /**
     * @param array<int, array<string, mixed>> $records
     * @return array{title: string, records: array<int, array<string, mixed>>}
     */
    private static function section(string $title, array $records): array
    {
        return ['title' => $title, 'records' => array_values($records)];
    }

    private static function reportNotes(object $row): string
    {
        $parts = [];
        foreach ([
            'Mood' => $row->mood,
            'Attitude and engagement' => $row->attitude,
            'Learning' => $row->learning,
            'Enthusiasm' => $row->enthusiasm,
            'Discussion' => $row->discussions,
            'Points for next shift' => $row->pointsToNote,
            'Plan' => $row->plan,
            'Observations' => $row->suggestions,
        ] as $label => $value) {
            if (self::clean($value) !== null) {
                $parts[] = "$label: $value";
            }
        }

        return implode("\n", $parts);
    }

    private static function clean(?string $value): ?string
    {
        if ($value === null) {
            return null;
        }

        return trim($value) === '' ? null : trim($value);
    }

    private static function titleCase(?string $value): ?string
    {
        return $value === null ? null : str_replace('_', ' ', $value);
    }

    /** @param array<int, string|null> $parts */
    private static function join(string $glue, array $parts): string
    {
        return implode($glue, array_filter($parts, static fn (?string $part) => $part !== null && $part !== ''));
    }

    private static function millis(mixed $value): ?int
    {
        $date = Dates::fromDatabase($value);

        return $date === null ? null : $date->getTimestamp() * 1000;
    }

    /** "20/09/2026", as Date#toLocaleDateString("en-GB") renders it. */
    private static function shortDate(int $millis): string
    {
        return gmdate('d/m/Y', intdiv($millis, 1000));
    }

    /** "20/09/2026, 14:00:00", as Date#toLocaleString("en-GB") renders it. */
    private static function longDate(int $millis): string
    {
        return gmdate('d/m/Y, H:i:s', intdiv($millis, 1000));
    }

    /** A millisecond bound as the datetime string a `timestamp` column compares against. */
    private static function sqlTime(int $millis): string
    {
        return gmdate('Y-m-d H:i:s', intdiv($millis, 1000));
    }
}
