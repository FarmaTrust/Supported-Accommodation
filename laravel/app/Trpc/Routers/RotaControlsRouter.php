<?php

declare(strict_types=1);

namespace App\Trpc\Routers;

use App\Support\Audit;
use App\Support\Authz;
use App\Support\Dates;
use App\Support\RotaRules;
use App\Trpc\Context;
use App\Trpc\Registry;
use App\Trpc\TrpcException;
use App\Trpc\Validate;
use Illuminate\Support\Facades\DB;

/**
 * rotaControls.*, mirroring server/routers/rotaControls.ts.
 *
 * The controls around the rota rather than the rota itself: who is available,
 * the working-time policy in force, the exceptions a rota raises against it,
 * changes to staffing and the worked-shift summaries payroll reads.
 *
 * The rule arithmetic lives in RotaRules, ported with the scheduling rules. This
 * router is the wiring: read the rows, hand them to the rules, write back what
 * comes out.
 */
final class RotaControlsRouter
{
    private const DAY_MS = 86400000;

    private const AVAILABILITY_TYPES = [
        'available', 'unavailable', 'preferred', 'annual_leave', 'sickness', 'training', 'agency_constraint', 'other',
    ];
    private const PREFERENCE_LEVELS = ['required', 'strong', 'normal', 'avoid'];
    private const CHANGE_TYPES = ['additional', 'replacement', 'emergency'];
    private const CHANGE_REASONS = [
        'sickness', 'annual_leave', 'training', 'coverage_gap', 'safeguarding_need', 'appointment', 'emergency', 'other',
    ];
    private const OVERRIDE_DECISIONS = ['approved', 'declined'];

    public static function register(Registry $registry): void
    {
        $registry->query('rotaControls.workspace', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyIds = Authz::accessiblePropertyIds($ctx->userId(), $entityId, 'shift.read');

            $now = Dates::nowMillis();
            $from = Validate::optionalInt($input['from'] ?? null, 'from') ?? $now - 30 * self::DAY_MS;
            $to = Validate::optionalInt($input['to'] ?? null, 'to') ?? $now + 60 * self::DAY_MS;

            $shifts = $propertyIds === [] ? [] : DB::table('shifts')
                ->where('entityId', $entityId)
                ->whereIn('propertyId', $propertyIds)
                ->where('startsAt', '>=', $from)->where('startsAt', '<=', $to)
                ->orderByDesc('startsAt')
                ->get()->map(static fn ($r) => (array) $r)->all();

            $shiftIds = array_map(static fn (array $shift) => (int) $shift['id'], $shifts);

            return [
                'shifts' => $shifts,
                // Availability overlapping the window, not only starting in it:
                // a fortnight of leave booked last month still blocks today.
                'availability' => DB::table('staffAvailability')
                    ->where('entityId', $entityId)
                    ->where('startsAt', '<=', $to)->where('endsAt', '>=', $from)
                    ->orderByDesc('startsAt')
                    ->get()->map(static fn ($r) => (array) $r)->all(),
                'policies' => DB::table('workingTimePolicies')
                    ->where('entityId', $entityId)->orderByDesc('effectiveFrom')
                    ->get()->map(static fn ($r) => (array) $r)->all(),
                // Only the exceptions belonging to shifts on screen, so the list
                // cannot show one for a property the reader cannot reach.
                'exceptions' => $shiftIds === [] ? [] : DB::table('workingTimeExceptions')
                    ->where('entityId', $entityId)->whereIn('shiftId', $shiftIds)
                    ->orderByDesc('createdAt')
                    ->get()->map(static fn ($r) => (array) $r)->all(),
                'changes' => $propertyIds === [] ? [] : DB::table('shiftChangeEvents')
                    ->where('entityId', $entityId)->whereIn('propertyId', $propertyIds)
                    ->orderByDesc('createdAt')
                    ->get()->map(static fn ($r) => (array) $r)->all(),
                // Acknowledgements are the caller's own: they are what this
                // person still has to confirm they have seen.
                'acknowledgements' => DB::table('shiftChangeAcknowledgements')
                    ->where('entityId', $entityId)->where('userId', $ctx->userId())
                    ->orderByDesc('createdAt')
                    ->get()->map(static fn ($r) => (array) $r)->all(),
                'summaries' => $propertyIds === [] ? [] : DB::table('workedShiftSummaries')
                    ->where('entityId', $entityId)->whereIn('propertyId', $propertyIds)
                    ->orderByDesc('summaryGeneratedAt')
                    ->get()->map(static fn ($r) => (array) $r)->all(),
                'workers' => DB::table('staffProfiles as sp')
                    ->join('users as u', 'u.id', '=', 'sp.userId')
                    ->where('sp.entityId', $entityId)
                    ->select(['sp.id as staffProfileId', 'u.id as userId', 'u.name'])
                    ->get()->map(static fn ($r) => (array) $r)->all(),
            ];
        });

        $registry->mutation('rotaControls.createAvailability', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::assertScheduler($ctx, $input);

            $startsAt = Validate::int($input['startsAt'] ?? null, 'startsAt');
            $endsAt = Validate::int($input['endsAt'] ?? null, 'endsAt');
            if ($endsAt <= $startsAt) {
                throw TrpcException::badRequest('Availability end must be after start');
            }

            $staffProfileId = Validate::id($input['staffProfileId'] ?? null, 'staffProfileId');
            $staff = DB::table('staffProfiles')
                ->where('id', $staffProfileId)->where('entityId', $entityId)->first('id');
            if ($staff === null) {
                throw TrpcException::notFound('Staff profile not found');
            }

            $id = (int) DB::table('staffAvailability')->insertGetId([
                'entityId' => $entityId,
                'staffProfileId' => $staffProfileId,
                'propertyId' => Validate::optionalId($input['propertyId'] ?? null, 'propertyId'),
                'availabilityType' => Validate::enum($input['availabilityType'] ?? null, self::AVAILABILITY_TYPES, 'availabilityType'),
                'startsAt' => $startsAt,
                'endsAt' => $endsAt,
                'preferenceLevel' => Validate::enum($input['preferenceLevel'] ?? 'normal', self::PREFERENCE_LEVELS, 'preferenceLevel'),
                'reason' => Validate::optionalString($input['reason'] ?? null, 'reason', 500),
                'createdBy' => $ctx->userId(),
            ]);

            return ['id' => $id];
        });

        $registry->mutation('rotaControls.approveAvailability', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::assertScheduler($ctx, $input);
            $row = self::findOwned('staffAvailability', $input['availabilityId'] ?? null, 'availabilityId', $entityId, 'Availability record not found');

            // Leave and unavailability change who can be rostered, so it is not
            // approved by whoever entered it.
            if ((int) $row->createdBy === $ctx->userId()) {
                throw TrpcException::forbidden('A different manager must approve the availability record');
            }

            DB::table('staffAvailability')->where('id', $row->id)->update([
                'status' => 'approved',
                'approvedBy' => $ctx->userId(),
                'approvedAt' => Dates::nowMillis(),
            ]);

            return ['success' => true];
        });

        $registry->mutation('rotaControls.createPolicy', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'config.write');

            // The hour limits arrive as decimal strings and are stored as
            // DECIMAL, so they are kept as given rather than run through a float.
            $id = (int) DB::table('workingTimePolicies')->insertGetId([
                'entityId' => $entityId,
                'name' => Validate::string($input['name'] ?? null, 'name', 3, 180),
                'minimumRestHours' => self::hoursValue($input['minimumRestHours'] ?? null, 'minimumRestHours', '11.00'),
                'maximumShiftHours' => self::hoursValue($input['maximumShiftHours'] ?? null, 'maximumShiftHours', '12.00'),
                'maximumWeeklyHours' => self::hoursValue($input['maximumWeeklyHours'] ?? null, 'maximumWeeklyHours', '48.00'),
                'maximumNightHours' => self::hoursValue($input['maximumNightHours'] ?? null, 'maximumNightHours', '8.00'),
                'breakAfterHours' => self::hoursValue($input['breakAfterHours'] ?? null, 'breakAfterHours', '6.00'),
                'breakMinutes' => Validate::int($input['breakMinutes'] ?? 20, 'breakMinutes', 0, 180),
                'effectiveFrom' => Dates::nowMillis(),
                'createdBy' => $ctx->userId(),
            ]);

            return ['id' => $id];
        });

        $registry->mutation('rotaControls.approvePolicy', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'config.write');

            $row = self::findOwned('workingTimePolicies', $input['policyId'] ?? null, 'policyId', $entityId, 'Working-time policy not found');

            if ((int) $row->createdBy === $ctx->userId()) {
                throw TrpcException::forbidden('A different authorised user must approve the working-time policy');
            }

            // One policy is in force at a time, so activating this one retires
            // whatever was active. Both writes are in one transaction: a company
            // with two active policies has no answer to what its limits are.
            DB::transaction(static function () use ($ctx, $entityId, $row): void {
                $now = Dates::nowMillis();

                DB::table('workingTimePolicies')
                    ->where('entityId', $entityId)->where('status', 'active')
                    ->update(['status' => 'superseded', 'effectiveTo' => $now]);

                DB::table('workingTimePolicies')->where('id', $row->id)->update([
                    'status' => 'active',
                    'approvedBy' => $ctx->userId(),
                    'approvedAt' => $now,
                ]);
            });

            return ['success' => true];
        });

        $registry->mutation('rotaControls.changeStaffing', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $original = self::findOwned('shifts', $input['shiftId'] ?? null, 'shiftId', $entityId, 'Shift not found');

            // The property comes from the shift, so the check is against where
            // the work actually is.
            Authz::assertPropertyCapability($ctx->userId(), $entityId, (int) $original->propertyId, 'shift.write');

            $changeType = Validate::enum($input['changeType'] ?? null, self::CHANGE_TYPES, 'changeType');
            $affectedUserId = Validate::id($input['affectedUserId'] ?? null, 'affectedUserId');
            $reasonKey = Validate::enum($input['reasonKey'] ?? null, self::CHANGE_REASONS, 'reasonKey');
            $reason = Validate::string($input['reason'] ?? null, 'reason', 5, 2000);

            $previous = [
                'assignedUserId' => $original->assignedUserId === null ? null : (int) $original->assignedUserId,
                'status' => $original->status,
                'coverageState' => $original->coverageState,
            ];

            $changedShiftId = DB::transaction(static function () use (
                $ctx, $entityId, $original, $changeType, $affectedUserId, $reasonKey, $reason, $previous
            ): int {
                if (RotaRules::staffingChangeStrategy($changeType) === 'reassign_existing') {
                    // A replacement moves the shift; extra or emergency cover
                    // adds one beside it so the original worker stays rostered.
                    DB::table('shifts')->where('id', $original->id)->update([
                        'assignedUserId' => $affectedUserId,
                        'status' => 'assigned',
                        'coverageState' => 'covered',
                    ]);
                    $changedShiftId = (int) $original->id;
                } else {
                    $changedShiftId = (int) DB::table('shifts')->insertGetId([
                        'entityId' => $entityId,
                        'propertyId' => (int) $original->propertyId,
                        'assignedUserId' => $affectedUserId,
                        'title' => $original->title . ' — ' . $changeType,
                        'startsAt' => (int) $original->startsAt,
                        'endsAt' => (int) $original->endsAt,
                        'requiredRole' => $original->requiredRole,
                        'status' => 'assigned',
                        'coverageState' => 'covered',
                        'notes' => $reason,
                        'createdBy' => $ctx->userId(),
                    ]);
                }

                $eventId = (int) DB::table('shiftChangeEvents')->insertGetId([
                    'entityId' => $entityId,
                    'propertyId' => (int) $original->propertyId,
                    'shiftId' => $changedShiftId,
                    'eventType' => $changeType,
                    'reasonKey' => $reasonKey,
                    'reason' => $reason,
                    'previousSnapshot' => json_encode($previous, JSON_UNESCAPED_SLASHES),
                    'newSnapshot' => json_encode([
                        'assignedUserId' => $affectedUserId,
                        'status' => 'assigned',
                        'sourceShiftId' => (int) $original->id,
                    ], JSON_UNESCAPED_SLASHES),
                    'affectedUserId' => $affectedUserId,
                    'createdBy' => $ctx->userId(),
                ]);

                $recipients = RotaRules::staffingAcknowledgementRecipients(
                    $changeType,
                    $original->assignedUserId === null ? null : (int) $original->assignedUserId,
                    $affectedUserId,
                );

                foreach ($recipients as $userId) {
                    DB::table('shiftChangeAcknowledgements')->insert([
                        'entityId' => $entityId,
                        'shiftChangeEventId' => $eventId,
                        'userId' => $userId,
                    ]);
                }

                return $changedShiftId;
            });

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'propertyId' => (int) $original->propertyId,
                'action' => "shift.$changeType",
                'resourceType' => 'shift',
                'resourceId' => $changedShiftId,
                'sensitivity' => 'general',
                'result' => 'success',
            ]);

            return ['id' => $changedShiftId];
        });

        $registry->mutation('rotaControls.evaluateWorkingTime', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::assertScheduler($ctx, $input);
            $propertyIds = Authz::accessiblePropertyIds($ctx->userId(), $entityId, 'shift.read');

            $from = Validate::int($input['from'] ?? null, 'from');
            $to = Validate::int($input['to'] ?? null, 'to');

            $policy = DB::table('workingTimePolicies')
                ->where('entityId', $entityId)->where('status', 'active')
                ->orderByDesc('effectiveFrom')->first();

            // Without a policy there is nothing to measure against, and writing
            // exceptions from defaults nobody approved would be worse than none.
            if ($policy === null) {
                throw new TrpcException('PRECONDITION_FAILED', 'Activate a working-time policy before evaluation');
            }

            $assigned = [];
            if ($propertyIds !== []) {
                foreach (DB::table('shifts')
                    ->where('entityId', $entityId)->whereIn('propertyId', $propertyIds)
                    ->where('startsAt', '>=', $from)->where('startsAt', '<=', $to)
                    ->whereNotNull('assignedUserId')
                    ->get(['id', 'assignedUserId', 'startsAt', 'endsAt']) as $row) {
                    $assigned[] = [
                        'id' => (int) $row->id,
                        'userId' => (int) $row->assignedUserId,
                        'startsAt' => (int) $row->startsAt,
                        'endsAt' => (int) $row->endsAt,
                    ];
                }
            }

            // Availability is held against the staff profile, but the rules work
            // in user ids, so it is translated here.
            $userIdByProfile = DB::table('staffProfiles')->where('entityId', $entityId)
                ->whereNotNull('userId')->pluck('userId', 'id')->all();

            $availability = [];
            foreach (DB::table('staffAvailability')
                ->where('entityId', $entityId)
                ->where('startsAt', '<=', $to)->where('endsAt', '>=', $from)
                ->get() as $row) {
                $userId = $userIdByProfile[(int) $row->staffProfileId] ?? null;
                if ($userId === null) {
                    continue;
                }
                $availability[] = [
                    'userId' => (int) $userId,
                    'startsAt' => (int) $row->startsAt,
                    'endsAt' => (int) $row->endsAt,
                    'availabilityType' => (string) $row->availabilityType,
                    'status' => (string) $row->status,
                ];
            }

            $limits = [
                'minimumRestHours' => (float) $policy->minimumRestHours,
                'maximumShiftHours' => (float) $policy->maximumShiftHours,
                'maximumWeeklyHours' => (float) $policy->maximumWeeklyHours,
                'maximumNightHours' => (float) $policy->maximumNightHours,
                'breakAfterHours' => (float) $policy->breakAfterHours,
            ];

            // Re-running evaluation must not pile up duplicates, so what is
            // already recorded is loaded once and used as the key set.
            $existingKeys = [];
            foreach (DB::table('workingTimeExceptions')->where('entityId', $entityId)
                ->get(['shiftId', 'userId', 'exceptionType']) as $row) {
                $existingKeys["{$row->shiftId}:{$row->userId}:{$row->exceptionType}"] = true;
            }

            $created = 0;
            foreach ($assigned as $target) {
                foreach (RotaRules::evaluateWorkingTime($target, $assigned, $availability, $limits) as $issue) {
                    $key = "{$target['id']}:{$target['userId']}:{$issue['exceptionType']}";
                    if (isset($existingKeys[$key])) {
                        continue;
                    }

                    DB::table('workingTimeExceptions')->insert([
                        'entityId' => $entityId,
                        'shiftId' => $target['id'],
                        'userId' => $target['userId'],
                        'policyId' => (int) $policy->id,
                        'exceptionType' => $issue['exceptionType'],
                        'severity' => $issue['severity'],
                        'detail' => $issue['detail'],
                    ]);

                    $existingKeys[$key] = true;
                    $created++;
                }
            }

            return ['evaluated' => count($assigned), 'created' => $created];
        });

        $registry->mutation('rotaControls.acknowledgeChange', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $acknowledgementId = Validate::id($input['acknowledgementId'] ?? null, 'acknowledgementId');

            // Scoped to the caller's own row: an acknowledgement is a statement
            // that this person saw the change, so nobody else can make it.
            $row = DB::table('shiftChangeAcknowledgements')
                ->where('id', $acknowledgementId)
                ->where('entityId', $entityId)
                ->where('userId', $ctx->userId())
                ->first(['id', 'readAt']);

            if ($row === null) {
                throw TrpcException::notFound('Acknowledgement not found');
            }

            $now = Dates::nowMillis();

            DB::table('shiftChangeAcknowledgements')->where('id', $row->id)->update([
                'status' => 'acknowledged',
                // An existing read time is kept: it says when they first saw it.
                'readAt' => $row->readAt === null ? $now : (int) $row->readAt,
                'acknowledgedAt' => $now,
            ]);

            return ['success' => true];
        });

        $registry->mutation('rotaControls.overrideException', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::assertScheduler($ctx, $input);
            $row = self::findOwned('workingTimeExceptions', $input['exceptionId'] ?? null, 'exceptionId', $entityId, 'Working-time exception not found');

            // The limits exist to protect the worker, so the worker is not the
            // one who waives them.
            if ((int) $row->userId === $ctx->userId()) {
                throw TrpcException::forbidden('Workers cannot approve their own working-time exception');
            }

            DB::table('workingTimeExceptions')->where('id', $row->id)->update([
                'overrideStatus' => Validate::enum($input['decision'] ?? null, self::OVERRIDE_DECISIONS, 'decision'),
                'overrideReason' => Validate::string($input['reason'] ?? null, 'reason', 20, 3000),
                'overrideBy' => $ctx->userId(),
                'overrideAt' => Dates::nowMillis(),
            ]);

            return ['success' => true];
        });

        $registry->mutation('rotaControls.generateSummaries', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::assertScheduler($ctx, $input);
            $propertyIds = Authz::accessiblePropertyIds($ctx->userId(), $entityId, 'shift.read');

            $from = Validate::int($input['from'] ?? null, 'from');
            $to = Validate::int($input['to'] ?? null, 'to');

            if ($propertyIds === []) {
                return ['generated' => 0];
            }

            $rows = DB::table('shifts as s')
                ->join('users as u', 'u.id', '=', 's.assignedUserId')
                ->join('properties as p', 'p.id', '=', 's.propertyId')
                ->where('s.entityId', $entityId)
                ->where('s.status', 'completed')
                ->whereIn('s.propertyId', $propertyIds)
                ->where('s.startsAt', '>=', $from)->where('s.startsAt', '<=', $to)
                ->select([
                    's.id', 's.propertyId', 's.startsAt', 's.endsAt', 's.status',
                    'u.id as userId', 'u.name as userName', 'p.name as propertyName',
                ])
                ->get();

            $now = Dates::nowMillis();
            $generated = 0;

            foreach ($rows as $row) {
                $clocked = self::clockedMinutes((int) $row->id);
                $state = RotaRules::workedSummaryState($clocked);

                $lastChange = DB::table('shiftChangeEvents')
                    ->where('shiftId', $row->id)->orderByDesc('createdAt')->first('eventType');

                $staffingType = in_array($lastChange->eventType ?? null, ['additional', 'replacement', 'emergency'], true)
                    ? $lastChange->eventType
                    : 'standard';

                // A summary is one per shift and worker, so a re-run refreshes
                // the row rather than adding a second one beside it. The
                // snapshots and the staffing type are left as first written.
                DB::table('workedShiftSummaries')->upsert(
                    [[
                        'entityId' => $entityId,
                        'propertyId' => (int) $row->propertyId,
                        'shiftId' => (int) $row->id,
                        'userId' => (int) $row->userId,
                        'workerNameSnapshot' => $row->userName ?? ('User ' . (int) $row->userId),
                        'propertyNameSnapshot' => $row->propertyName,
                        'scheduledMinutes' => (int) round(((int) $row->endsAt - (int) $row->startsAt) / 60000),
                        'clockedMinutes' => $clocked,
                        'approvedMinutes' => $clocked,
                        'staffingType' => $staffingType,
                        'shiftStatus' => $row->status,
                        'exceptionState' => $state['exceptionState'],
                        'payrollState' => $state['payrollState'],
                        'summaryGeneratedAt' => $now,
                    ]],
                    ['shiftId', 'userId'],
                    ['clockedMinutes', 'approvedMinutes', 'exceptionState', 'payrollState', 'summaryGeneratedAt'],
                );

                $generated++;
            }

            return ['generated' => $generated];
        });

        $registry->mutation('rotaControls.approveSummary', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::assertScheduler($ctx, $input);
            $row = self::findOwned('workedShiftSummaries', $input['summaryId'] ?? null, 'summaryId', $entityId, 'Worked-shift summary not found');

            // This is the row payroll pays from, so nobody signs off their own.
            if ((int) $row->userId === $ctx->userId()) {
                throw TrpcException::forbidden('Workers cannot approve their own worked-shift summary');
            }

            DB::table('workedShiftSummaries')->where('id', $row->id)->update([
                'approvedMinutes' => Validate::int($input['approvedMinutes'] ?? null, 'approvedMinutes', 0, 1440),
                'payrollState' => 'approved',
                'approvedBy' => $ctx->userId(),
                'approvedAt' => Dates::nowMillis(),
            ]);

            return ['success' => true];
        });
    }

    private static function assertScheduler(Context $ctx, mixed $input): int
    {
        $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
        Authz::assertEntityCapability($ctx->userId(), $entityId, 'shift.write');

        return $entityId;
    }

    /** A record named in the request, confirmed to belong to this company. */
    private static function findOwned(string $table, mixed $id, string $field, int $entityId, string $missing): object
    {
        $row = DB::table($table)
            ->where('id', Validate::id($id, $field))
            ->where('entityId', $entityId)
            ->first();

        if ($row === null) {
            throw TrpcException::notFound($missing);
        }

        return $row;
    }

    /**
     * Minutes actually worked: first clock in to last clock out. Null when
     * either is missing, which is what holds the shift back from payroll.
     */
    private static function clockedMinutes(int $shiftId): ?int
    {
        $clocks = DB::table('clockEvents')->where('shiftId', $shiftId)
            ->orderBy('occurredAt')->get(['eventType', 'occurredAt']);

        $clockIn = null;
        $clockOut = null;
        foreach ($clocks as $clock) {
            if ($clock->eventType === 'clock_in' && $clockIn === null) {
                $clockIn = (int) $clock->occurredAt;
            }
            if ($clock->eventType === 'clock_out') {
                $clockOut = (int) $clock->occurredAt;
            }
        }

        if ($clockIn === null || $clockOut === null) {
            return null;
        }

        return max(0, (int) round(($clockOut - $clockIn) / 60000));
    }

    /**
     * An hours limit as the DECIMAL column stores it. The client sends these as
     * strings, so they are checked as strings rather than passed through a float
     * that would round "11.005" before the database saw it.
     */
    private static function hoursValue(mixed $value, string $field, string $default): string
    {
        if ($value === null) {
            return $default;
        }

        $text = is_int($value) || is_float($value) ? (string) $value : $value;
        if (!is_string($text) || preg_match('/^\d{1,4}(\.\d{1,2})?$/', $text) !== 1) {
            throw TrpcException::badRequest(
                ucfirst(strtolower(trim(preg_replace('/(?<!^)[A-Z]/', ' $0', $field) ?? $field)))
                . ' must be a number of hours, for example 11.00.'
            );
        }

        return $text;
    }
}
