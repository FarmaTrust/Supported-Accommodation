<?php

declare(strict_types=1);

namespace App\Trpc\Routers;

use App\Support\AgePolicy;
use App\Support\Audit;
use App\Support\Authz;
use App\Support\CareRules;
use App\Support\Dates;
use App\Support\EncryptedFields;
use App\Trpc\Context;
use App\Trpc\Registry;
use App\Trpc\TrpcException;
use App\Trpc\Validate;
use Illuminate\Support\Facades\DB;

/**
 * care.*, mirroring server/routers/care.ts.
 *
 * The day-to-day care record for one young person: who the professionals around
 * them are, what health monitoring and medicines are in place, the curfew, and
 * the college, court and appointment diary. Almost every free-text field here is
 * encrypted at rest, so nothing is returned without going through
 * EncryptedFields.
 *
 * Every procedure is scoped to one placement through
 * assertCurrentShiftPlacementCapability, which means a support worker reaches
 * these records only while on shift at the property the young person lives at.
 */
final class CareRouter
{
    private const ROUTINE_TEMPLATE_TYPES = ['health', 'medication', 'curfew'];

    private const CONTACT_TYPES = [
        'social_worker', 'iro', 'personal_adviser', 'emergency_duty_team', 'health',
        'education', 'probation', 'court', 'family_advocate', 'other',
    ];
    private const CONTACT_METHODS = ['phone', 'email', 'secure_email', 'portal', 'other'];

    private const MONITORING_TYPES = [
        'blood_pressure', 'blood_glucose', 'weight', 'temperature', 'seizure', 'sleep',
        'nutrition', 'hydration', 'mental_wellbeing', 'pain', 'wound', 'other',
    ];
    private const MONITORING_FREQUENCIES = [
        'as_required', 'once_daily', 'twice_daily', 'weekly', 'monthly', 'event_based', 'other',
    ];
    private const RESPONSIBLE_ROLES = ['key_worker', 'support_worker', 'manager', 'health_professional', 'other'];
    private const CONSENT_BASES = ['young_person_consent', 'care_plan', 'clinical_instruction', 'best_interests', 'other'];
    private const HEALTH_OUTCOMES = ['within_expected', 'outside_expected', 'unable', 'declined', 'not_required', 'other'];

    private const MEDICATION_FORMS = ['tablet', 'capsule', 'liquid', 'inhaler', 'cream', 'injection', 'patch', 'drops', 'other'];
    private const MEDICATION_ROUTES = ['oral', 'inhaled', 'topical', 'subcutaneous', 'intramuscular', 'eye', 'ear', 'nasal', 'other'];
    private const MEDICATION_FREQUENCIES = [
        'once_daily', 'twice_daily', 'three_times_daily', 'four_times_daily', 'weekly', 'as_required', 'other',
    ];
    private const MEDICATION_OUTCOMES = ['taken', 'refused', 'omitted', 'unavailable', 'asleep', 'away', 'other'];

    private const CURFEW_STATUSES = ['met', 'late', 'absent', 'authorised_away', 'not_applicable', 'pending'];

    private const ACTIVITY_TYPES = ['college', 'education', 'court', 'probation', 'health', 'professional', 'contact', 'other'];
    private const ATTENDANCE_STATUSES = [
        'scheduled', 'attended', 'late', 'did_not_attend', 'cancelled_by_service',
        'cancelled_by_young_person', 'rescheduled', 'not_required',
    ];
    private const TRANSPORT_MODES = ['independent', 'staff', 'taxi', 'public_transport', 'family', 'authority', 'other'];

    private const ACKNOWLEDGE_RECORD_TYPES = ['health_event', 'medication', 'curfew', 'activity'];

    /** The history feed is capped rather than paged, as on the Node side. */
    private const HISTORY_LIMIT = 150;

    public static function register(Registry $registry): void
    {
        $registry->query('care.templates', Registry::USER, static function (Context $ctx, mixed $input): array {
            [$entityId] = self::guard($ctx, $input, 'young_person.read');

            $templates = [];
            foreach (DB::table('documentTemplates')
                ->where('entityId', $entityId)
                ->where('status', 'active')
                ->where('category', 'support_plan')
                ->get() as $row) {
                $routineType = self::routineTypeOf($row->fieldSchema);
                if ($routineType === null) {
                    continue;
                }
                $templates[] = [
                    'id' => (int) $row->id,
                    'templateKey' => $row->templateKey,
                    'title' => $row->title,
                    'version' => (int) $row->version,
                    'routineType' => $routineType,
                    'bodyTemplate' => $row->bodyTemplate,
                ];
            }

            return $templates;
        });

        $registry->mutation('care.createRoutineTemplate', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $access = Authz::assertEntityCapability($ctx->userId(), $entityId, 'young_person.write');

            // A care routine template becomes the wording every worker follows,
            // so writing one is a manager's decision rather than a worker's.
            if (!in_array($access['role'], ['owner', 'registered_manager'], true)) {
                throw TrpcException::forbidden('Only an Owner or Registered Manager can manage care routine templates');
            }

            $routineType = Validate::enum($input['routineType'] ?? null, self::ROUTINE_TEMPLATE_TYPES, 'routineType');
            $title = Validate::string($input['title'] ?? null, 'title', 3, 220);
            $instructions = Validate::string($input['instructions'] ?? null, 'instructions', 20, 10000);

            $keyPart = trim(preg_replace('/[^a-z0-9]+/', '_', strtolower($title)) ?? '', '_');
            $keyPart = substr($keyPart, 0, 64);
            if ($keyPart === '') {
                $keyPart = 'routine';
            }
            $templateKey = "care_routine_{$routineType}_{$keyPart}";

            $existing = DB::table('documentTemplates')
                ->where('entityId', $entityId)
                ->where('templateKey', $templateKey)
                ->orderByDesc('version')
                ->first(['id', 'version']);

            $version = ($existing === null ? 0 : (int) $existing->version) + 1;

            // A template is superseded rather than edited: records already
            // written against version 3 must still say what version 3 said.
            if ($existing !== null) {
                DB::table('documentTemplates')->where('id', $existing->id)->update(['status' => 'superseded']);
            }

            $id = (int) DB::table('documentTemplates')->insertGetId([
                'entityId' => $entityId,
                'templateKey' => $templateKey,
                'title' => $title,
                'category' => 'support_plan',
                'version' => $version,
                'fieldSchema' => json_encode(['routineType' => $routineType], JSON_UNESCAPED_SLASHES),
                'bodyTemplate' => $instructions,
                'status' => 'active',
                'createdBy' => $ctx->userId(),
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'care.routine_template.create',
                'resourceType' => 'document_template',
                'resourceId' => $id,
                'sensitivity' => 'restricted',
                'result' => 'success',
                'metadata' => ['routineType' => $routineType, 'version' => $version],
            ]);

            return ['id' => $id, 'version' => $version];
        });

        $registry->query('care.workspace', Registry::USER, static function (Context $ctx, mixed $input): array {
            [$entityId, $placementId] = self::guard($ctx, $input, 'young_person.read');

            $byPlacement = static fn (string $table) => DB::table($table)->where('placementId', $placementId);

            return [
                'contacts' => EncryptedFields::revealAll(
                    $byPlacement('professionalContacts')->orderByDesc('createdAt')->get(),
                    ['notes'],
                ),
                'healthPlans' => EncryptedFields::revealAll(
                    $byPlacement('healthMonitoringPlans')->orderByDesc('createdAt')->get(),
                    ['instructions', 'escalationAction'],
                ),
                'healthEvents' => EncryptedFields::revealAll(
                    $byPlacement('healthMonitoringEvents')->orderByDesc('occurredAt')->get(),
                    ['notes'],
                ),
                // stockNotes is deliberately not revealed: it is stock control
                // rather than care information, and strip() drops the column.
                'medications' => EncryptedFields::revealAll(
                    $byPlacement('medications')->orderByDesc('createdAt')->get(),
                    ['instructions', 'prnInstructions'],
                ),
                'administrations' => $byPlacement('medicationAdministrations')
                    ->orderByDesc('scheduledAt')->get()->map(static fn ($r) => (array) $r)->all(),
                'curfewPlans' => EncryptedFields::revealAll(
                    $byPlacement('curfewPlans')->orderByDesc('createdAt')->get(),
                    ['instructions'],
                ),
                'curfewChecks' => $byPlacement('curfewChecks')
                    ->orderByDesc('expectedAt')->get()->map(static fn ($r) => (array) $r)->all(),
                'activities' => EncryptedFields::revealAll(
                    $byPlacement('scheduledActivities')->orderByDesc('scheduledStart')->get(),
                    ['outcome', 'followUp'],
                ),
                'snippets' => DB::table('standardTextSnippets')
                    ->where('entityId', $entityId)->where('status', 'active')
                    ->get()->map(static fn ($r) => (array) $r)->all(),
            ];
        });

        $registry->query('care.history', Registry::USER, static function (Context $ctx, mixed $input): array {
            [$entityId, $placementId, $scope] = self::guard($ctx, $input, 'young_person.read');

            $planTitles = DB::table('healthMonitoringPlans')->where('placementId', $placementId)
                ->pluck('title', 'id')->all();
            $medicationNames = DB::table('medications')->where('placementId', $placementId)
                ->pluck('name', 'id')->all();
            $curfewTimes = DB::table('curfewPlans')->where('placementId', $placementId)
                ->pluck('expectedReturnTime', 'id')->all();

            $items = [];

            foreach (DB::table('healthMonitoringEvents')->where('placementId', $placementId)
                ->orderByDesc('occurredAt')->get() as $row) {
                $items[] = [
                    'id' => 'health-' . (int) $row->id,
                    'category' => 'Health monitoring',
                    'occurredAt' => (int) $row->occurredAt,
                    'title' => $planTitles[(int) $row->planId] ?? 'Health observation',
                    'detail' => self::humanise((string) $row->outcome),
                    'notes' => EncryptedFields::reveal((array) $row, ['notes'])['notes'],
                    'status' => (int) $row->escalationRequired === 1 ? 'escalation' : 'recorded',
                ];
            }

            foreach (DB::table('medicationAdministrations')->where('placementId', $placementId)
                ->orderByDesc('scheduledAt')->get() as $row) {
                $items[] = [
                    'id' => 'medication-' . (int) $row->id,
                    'category' => 'Medication',
                    'occurredAt' => (int) ($row->administeredAt ?? $row->scheduledAt),
                    'title' => $medicationNames[(int) $row->medicationId] ?? 'Medication',
                    'detail' => self::humanise((string) $row->outcome),
                    'notes' => EncryptedFields::reveal((array) $row, ['reason'])['reason'],
                    'status' => (int) $row->escalationRequired === 1
                        ? 'escalation'
                        : ($row->managerAcknowledgedAt !== null ? 'acknowledged' : 'review_due'),
                ];
            }

            foreach (DB::table('curfewChecks')->where('placementId', $placementId)
                ->orderByDesc('expectedAt')->get() as $row) {
                $items[] = [
                    'id' => 'curfew-' . (int) $row->id,
                    'category' => 'Curfew',
                    'occurredAt' => (int) ($row->actualAt ?? $row->expectedAt),
                    'title' => 'Expected return ' . ($curfewTimes[(int) $row->curfewPlanId] ?? 'time'),
                    'detail' => self::humanise((string) $row->status),
                    'notes' => EncryptedFields::reveal((array) $row, ['contactAttempts'])['contactAttempts'],
                    'status' => (int) $row->escalationRequired === 1
                        ? 'escalation'
                        : ($row->acknowledgedAt !== null ? 'acknowledged' : (string) $row->status),
                ];
            }

            foreach (DB::table('scheduledActivities')->where('placementId', $placementId)
                ->orderByDesc('scheduledStart')->get() as $row) {
                $revealed = EncryptedFields::reveal((array) $row, ['outcome', 'followUp']);
                $notes = array_values(array_filter(
                    [$revealed['outcome'], $revealed['followUp']],
                    static fn ($value) => $value !== null && $value !== '',
                ));
                $items[] = [
                    'id' => 'activity-' . (int) $row->id,
                    'category' => 'College, court and appointments',
                    'occurredAt' => (int) $row->scheduledStart,
                    'title' => self::humanise((string) $row->activityType) . ' · ' . $row->title,
                    'detail' => self::humanise((string) $row->attendanceStatus),
                    'notes' => implode("\n", $notes),
                    'status' => $row->acknowledgedAt !== null ? 'acknowledged' : (string) $row->attendanceStatus,
                ];
            }

            foreach (DB::table('keyWorkerReports as r')
                ->join('users as u', 'u.id', '=', 'r.authorUserId')
                ->where('r.placementId', $placementId)
                ->orderByDesc('r.reportDate')
                ->select(['r.*', 'u.name as authorName'])->get() as $row) {
                $items[] = [
                    'id' => 'report-' . (int) $row->id,
                    'category' => 'Keyworker report',
                    'occurredAt' => (int) $row->reportDate,
                    'title' => self::humanise((string) $row->reportType) . ' · ' . ($row->authorName ?? 'Key Worker'),
                    'detail' => self::humanise((string) $row->status),
                    'notes' => self::reportBody($row),
                    'status' => (string) $row->status,
                ];
            }

            usort($items, static fn (array $left, array $right) => $right['occurredAt'] <=> $left['occurredAt']);
            $items = array_slice($items, 0, self::HISTORY_LIMIT);

            // Reading a young person's whole history is itself a safeguarding
            // event, so it is recorded even though nothing changed.
            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'propertyId' => $scope['placement']['propertyId'] === null ? null : (int) $scope['placement']['propertyId'],
                'action' => 'care.placement_history.read',
                'resourceType' => 'placement',
                'resourceId' => $placementId,
                'sensitivity' => 'safeguarding',
                'result' => 'success',
                'metadata' => ['recordCount' => count($items)],
            ]);

            return ['items' => $items];
        });

        $registry->mutation('care.addContact', Registry::USER, static function (Context $ctx, mixed $input): array {
            [$entityId, $placementId] = self::guard($ctx, $input);

            $email = ($input['email'] ?? null) === null ? null : Validate::email($input['email']);

            $id = (int) DB::table('professionalContacts')->insertGetId([
                'entityId' => $entityId,
                'placementId' => $placementId,
                'contactType' => Validate::enum($input['contactType'] ?? null, self::CONTACT_TYPES, 'contactType'),
                'name' => Validate::string($input['name'] ?? null, 'name', 2, 180),
                'roleTitle' => Validate::optionalString($input['roleTitle'] ?? null, 'roleTitle', 180),
                'organisation' => Validate::optionalString($input['organisation'] ?? null, 'organisation', 220),
                'phone' => Validate::optionalString($input['phone'] ?? null, 'phone', 40),
                'email' => $email,
                'preferredContactMethod' => Validate::enum(
                    $input['preferredContactMethod'] ?? 'email',
                    self::CONTACT_METHODS,
                    'preferredContactMethod',
                ),
                'isPrimary' => Validate::bool($input['isPrimary'] ?? null, 'isPrimary') ? 1 : 0,
                'notesCiphertext' => EncryptedFields::seal(Validate::optionalString($input['notes'] ?? null, 'notes', 4000)),
                'createdBy' => $ctx->userId(),
            ]);

            return ['id' => $id];
        });

        $registry->mutation('care.createHealthPlan', Registry::USER, static function (Context $ctx, mixed $input): array {
            [$entityId, $placementId] = self::guard($ctx, $input);
            $template = self::resolveRoutineTemplate($entityId, $input['templateId'] ?? null, 'health');

            $id = (int) DB::table('healthMonitoringPlans')->insertGetId([
                'entityId' => $entityId,
                'placementId' => $placementId,
                'monitoringType' => Validate::enum($input['monitoringType'] ?? null, self::MONITORING_TYPES, 'monitoringType'),
                'templateId' => $template['id'] ?? null,
                'templateVersion' => $template['version'] ?? null,
                'title' => Validate::string($input['title'] ?? null, 'title', 3, 220),
                'frequency' => Validate::enum($input['frequency'] ?? null, self::MONITORING_FREQUENCIES, 'frequency'),
                'instructionsCiphertext' => EncryptedFields::seal(
                    Validate::string($input['instructions'] ?? null, 'instructions', 10, 8000),
                ),
                'expectedRange' => Validate::optionalString($input['expectedRange'] ?? null, 'expectedRange', 180),
                'escalationThreshold' => Validate::optionalString($input['escalationThreshold'] ?? null, 'escalationThreshold', 220),
                'escalationActionCiphertext' => EncryptedFields::seal(
                    Validate::optionalString($input['escalationAction'] ?? null, 'escalationAction', 5000),
                ),
                'responsibleRole' => Validate::enum($input['responsibleRole'] ?? 'key_worker', self::RESPONSIBLE_ROLES, 'responsibleRole'),
                'consentBasis' => Validate::enum($input['consentBasis'] ?? null, self::CONSENT_BASES, 'consentBasis'),
                'startsAt' => Dates::nowMillis(),
                'nextDueAt' => Validate::optionalInt($input['nextDueAt'] ?? null, 'nextDueAt'),
                'reviewDueAt' => Validate::int($input['reviewDueAt'] ?? null, 'reviewDueAt'),
                'status' => 'active',
                'createdBy' => $ctx->userId(),
            ]);

            return ['id' => $id];
        });

        $registry->mutation('care.recordHealthEvent', Registry::USER, static function (Context $ctx, mixed $input): array {
            [$entityId, $placementId] = self::guard($ctx, $input);
            $planId = Validate::id($input['planId'] ?? null, 'planId');

            // The plan has to belong to this placement, or an event would be
            // filed against another young person's monitoring.
            $plan = DB::table('healthMonitoringPlans')
                ->where('id', $planId)->where('placementId', $placementId)->first('id');
            if ($plan === null) {
                throw TrpcException::notFound('Health monitoring plan not found');
            }

            $outcome = Validate::enum($input['outcome'] ?? null, self::HEALTH_OUTCOMES, 'outcome');
            $escalation = CareRules::healthEscalationRequired(
                $outcome,
                Validate::bool($input['escalationRequired'] ?? null, 'escalationRequired'),
            );

            $id = (int) DB::table('healthMonitoringEvents')->insertGetId([
                'entityId' => $entityId,
                'placementId' => $placementId,
                'planId' => $planId,
                'occurredAt' => Dates::nowMillis(),
                'value' => Validate::optionalString($input['value'] ?? null, 'value', 180),
                'unit' => Validate::optionalString($input['unit'] ?? null, 'unit', 80),
                'outcome' => $outcome,
                'notesCiphertext' => EncryptedFields::seal(Validate::optionalString($input['notes'] ?? null, 'notes', 5000)),
                'escalationRequired' => $escalation ? 1 : 0,
                'escalationActionCiphertext' => EncryptedFields::seal(
                    Validate::optionalString($input['escalationAction'] ?? null, 'escalationAction', 5000),
                ),
                'createdBy' => $ctx->userId(),
            ]);

            return ['id' => $id];
        });

        $registry->mutation('care.createMedication', Registry::USER, static function (Context $ctx, mixed $input): array {
            [$entityId, $placementId] = self::guard($ctx, $input);
            $template = self::resolveRoutineTemplate($entityId, $input['templateId'] ?? null, 'medication');

            $id = (int) DB::table('medications')->insertGetId([
                'entityId' => $entityId,
                'placementId' => $placementId,
                'name' => Validate::string($input['name'] ?? null, 'name', 2, 220),
                'form' => Validate::enum($input['form'] ?? null, self::MEDICATION_FORMS, 'form'),
                'templateId' => $template['id'] ?? null,
                'templateVersion' => $template['version'] ?? null,
                'dose' => Validate::string($input['dose'] ?? null, 'dose', 1, 120),
                'route' => Validate::enum($input['route'] ?? null, self::MEDICATION_ROUTES, 'route'),
                'frequency' => Validate::enum($input['frequency'] ?? null, self::MEDICATION_FREQUENCIES, 'frequency'),
                'administrationWindow' => Validate::string($input['administrationWindow'] ?? null, 'administrationWindow', 1, 180),
                'instructionsCiphertext' => EncryptedFields::seal(
                    Validate::optionalString($input['instructions'] ?? null, 'instructions', 8000),
                ),
                'startsAt' => Dates::nowMillis(),
                'nextDueAt' => Validate::optionalInt($input['nextDueAt'] ?? null, 'nextDueAt'),
                'reviewDueAt' => Validate::optionalInt($input['reviewDueAt'] ?? null, 'reviewDueAt'),
                'status' => 'active',
                'createdBy' => $ctx->userId(),
            ]);

            return ['id' => $id];
        });

        $registry->mutation('care.recordMedication', Registry::USER, static function (Context $ctx, mixed $input): array {
            [$entityId, $placementId, $scope] = self::guard($ctx, $input);
            $medicationId = Validate::id($input['medicationId'] ?? null, 'medicationId');

            $medicine = DB::table('medications')
                ->where('id', $medicationId)->where('placementId', $placementId)->first(['id', 'nextDueAt']);
            if ($medicine === null) {
                throw TrpcException::notFound('Medication not found');
            }

            $outcome = Validate::enum($input['outcome'] ?? null, self::MEDICATION_OUTCOMES, 'outcome');
            $escalation = CareRules::medicationEscalationRequired(
                $outcome,
                Validate::bool($input['escalationRequired'] ?? null, 'escalationRequired'),
            );
            $now = Dates::nowMillis();

            $id = (int) DB::table('medicationAdministrations')->insertGetId([
                'entityId' => $entityId,
                'placementId' => $placementId,
                'medicationId' => $medicationId,
                'scheduledAt' => $medicine->nextDueAt === null ? $now : (int) $medicine->nextDueAt,
                // Only a medicine actually taken carries a time of administration.
                'administeredAt' => $outcome === 'taken' ? $now : null,
                'outcome' => $outcome,
                'doseAcknowledged' => Validate::optionalString($input['doseAcknowledged'] ?? null, 'doseAcknowledged', 120),
                'reasonCiphertext' => EncryptedFields::seal(Validate::optionalString($input['reason'] ?? null, 'reason', 5000)),
                'actionTakenCiphertext' => EncryptedFields::seal(
                    Validate::optionalString($input['actionTaken'] ?? null, 'actionTaken', 5000),
                ),
                'escalationRequired' => $escalation ? 1 : 0,
                'createdBy' => $ctx->userId(),
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'propertyId' => $scope['placement']['propertyId'] === null ? null : (int) $scope['placement']['propertyId'],
                'action' => 'medication.administration_recorded',
                'resourceType' => 'medication_administration',
                'resourceId' => $id,
                'sensitivity' => 'safeguarding',
                'result' => 'success',
                'metadata' => ['outcome' => $outcome, 'escalationRequired' => $escalation],
            ]);

            return ['id' => $id];
        });

        $registry->mutation('care.createCurfewPlan', Registry::USER, static function (Context $ctx, mixed $input): array {
            [$entityId, $placementId] = self::guard($ctx, $input);
            $template = self::resolveRoutineTemplate($entityId, $input['templateId'] ?? null, 'curfew');

            $weekdays = [];
            foreach (Validate::arrayOf($input['weekdays'] ?? null, 'weekdays', 7) as $index => $day) {
                $weekdays[] = Validate::int($day, "weekdays.$index", 0, 6);
            }
            if ($weekdays === []) {
                throw TrpcException::badRequest('Select at least one day of the week for this curfew.');
            }

            $id = (int) DB::table('curfewPlans')->insertGetId([
                'entityId' => $entityId,
                'placementId' => $placementId,
                'weekdays' => json_encode($weekdays),
                'expectedLeaveTime' => Validate::optionalString($input['expectedLeaveTime'] ?? null, 'expectedLeaveTime', 8),
                'expectedReturnTime' => Validate::string($input['expectedReturnTime'] ?? null, 'expectedReturnTime', 4, 8),
                'graceMinutes' => Validate::int($input['graceMinutes'] ?? 15, 'graceMinutes', 0, 180),
                'templateId' => $template['id'] ?? null,
                'templateVersion' => $template['version'] ?? null,
                'instructionsCiphertext' => EncryptedFields::seal(
                    Validate::optionalString($input['instructions'] ?? null, 'instructions', 5000),
                ),
                'escalationAfterMinutes' => Validate::int($input['escalationAfterMinutes'] ?? 30, 'escalationAfterMinutes', 0, 360),
                'startsAt' => Dates::nowMillis(),
                'reviewDueAt' => Validate::optionalInt($input['reviewDueAt'] ?? null, 'reviewDueAt'),
                'status' => 'active',
                'createdBy' => $ctx->userId(),
            ]);

            return ['id' => $id];
        });

        $registry->mutation('care.recordCurfew', Registry::USER, static function (Context $ctx, mixed $input): array {
            [$entityId, $placementId] = self::guard($ctx, $input);

            $status = Validate::enum($input['status'] ?? null, self::CURFEW_STATUSES, 'status');
            $escalation = CareRules::curfewEscalationRequired(
                $status,
                Validate::bool($input['escalationRequired'] ?? null, 'escalationRequired'),
            );

            $id = (int) DB::table('curfewChecks')->insertGetId([
                'entityId' => $entityId,
                'placementId' => $placementId,
                'curfewPlanId' => Validate::id($input['curfewPlanId'] ?? null, 'curfewPlanId'),
                'expectedAt' => Validate::int($input['expectedAt'] ?? null, 'expectedAt'),
                'actualAt' => Validate::optionalInt($input['actualAt'] ?? null, 'actualAt'),
                'status' => $status,
                'contactAttemptsCiphertext' => EncryptedFields::seal(
                    Validate::optionalString($input['contactAttempts'] ?? null, 'contactAttempts', 5000),
                ),
                'reasonCiphertext' => EncryptedFields::seal(Validate::optionalString($input['reason'] ?? null, 'reason', 5000)),
                'actionTakenCiphertext' => EncryptedFields::seal(
                    Validate::optionalString($input['actionTaken'] ?? null, 'actionTaken', 5000),
                ),
                'escalationRequired' => $escalation ? 1 : 0,
                'createdBy' => $ctx->userId(),
            ]);

            return ['id' => $id];
        });

        $registry->mutation('care.createActivity', Registry::USER, static function (Context $ctx, mixed $input): array {
            $scheduledStart = Validate::int($input['scheduledStart'] ?? null, 'scheduledStart');
            $scheduledEnd = Validate::optionalInt($input['scheduledEnd'] ?? null, 'scheduledEnd');
            // Checked before the access call, as on the Node side, so an obvious
            // typo is answered without touching the record.
            AgePolicy::assertDateRange($scheduledStart, $scheduledEnd, 'Scheduled activity', 'scheduledEnd');

            [$entityId, $placementId] = self::guard($ctx, $input);

            $id = (int) DB::table('scheduledActivities')->insertGetId([
                'entityId' => $entityId,
                'placementId' => $placementId,
                'activityType' => Validate::enum($input['activityType'] ?? null, self::ACTIVITY_TYPES, 'activityType'),
                'title' => Validate::string($input['title'] ?? null, 'title', 2, 220),
                'organisation' => Validate::optionalString($input['organisation'] ?? null, 'organisation', 220),
                'scheduledStart' => $scheduledStart,
                'scheduledEnd' => $scheduledEnd,
                'attendanceStatus' => Validate::enum(
                    $input['attendanceStatus'] ?? 'scheduled',
                    self::ATTENDANCE_STATUSES,
                    'attendanceStatus',
                ),
                'transport' => Validate::optionalEnum($input['transport'] ?? null, self::TRANSPORT_MODES, 'transport'),
                'outcomeCiphertext' => EncryptedFields::seal(Validate::optionalString($input['outcome'] ?? null, 'outcome', 5000)),
                'followUpCiphertext' => EncryptedFields::seal(Validate::optionalString($input['followUp'] ?? null, 'followUp', 5000)),
                'acknowledgementRequired' => Validate::bool($input['acknowledgementRequired'] ?? null, 'acknowledgementRequired', true) ? 1 : 0,
                'createdBy' => $ctx->userId(),
            ]);

            return ['id' => $id];
        });

        $registry->mutation('care.acknowledge', Registry::USER, static function (Context $ctx, mixed $input): array {
            [$entityId, $placementId] = self::guard($ctx, $input);

            $recordType = Validate::enum($input['recordType'] ?? null, self::ACKNOWLEDGE_RECORD_TYPES, 'recordType');
            $recordId = Validate::id($input['recordId'] ?? null, 'recordId');
            $now = Dates::nowMillis();

            if ($recordType === 'medication') {
                Authz::assertEntityCapability($ctx->userId(), $entityId, 'incident.review');

                $row = DB::table('medicationAdministrations')
                    ->where('id', $recordId)->where('placementId', $placementId)->first(['id', 'createdBy']);
                if ($row === null) {
                    throw TrpcException::notFound('Medication record not found');
                }

                // Signing off your own administration record would make the
                // second pair of eyes the same pair.
                if ((int) $row->createdBy === $ctx->userId()) {
                    throw TrpcException::forbidden('A different manager must acknowledge this medication record');
                }

                DB::table('medicationAdministrations')->where('id', $row->id)->update([
                    'managerAcknowledgedBy' => $ctx->userId(),
                    'managerAcknowledgedAt' => $now,
                ]);

                return ['success' => true];
            }

            $table = match ($recordType) {
                'health_event' => 'healthMonitoringEvents',
                'curfew' => 'curfewChecks',
                default => 'scheduledActivities',
            };

            DB::table($table)
                ->where('id', $recordId)->where('placementId', $placementId)
                ->update(['acknowledgedBy' => $ctx->userId(), 'acknowledgedAt' => $now]);

            return ['success' => true];
        });
    }

    /**
     * The placement gate every procedure here goes through.
     *
     * The entityId is checked against the placement rather than trusted: the
     * capability check runs against the placement's own company, so a mismatched
     * entityId would otherwise pass unnoticed and the caller would believe they
     * were working in a different company.
     *
     * @return array{0: int, 1: int, 2: array{placement: array<string, mixed>, access: array<string, mixed>}}
     */
    private static function guard(Context $ctx, mixed $input, string $capability = 'young_person.write'): array
    {
        $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
        $placementId = Validate::id($input['placementId'] ?? null, 'placementId');

        $scope = Authz::assertCurrentShiftPlacementCapability($ctx->userId(), $placementId, $capability);

        if ((int) $scope['placement']['entityId'] !== $entityId) {
            throw TrpcException::forbidden('This young person does not belong to the selected company.');
        }

        return [$entityId, $placementId, $scope];
    }

    /**
     * A named template has to be active, belong to this company and actually be
     * for this kind of routine.
     *
     * @return array{id: int, version: int}|null
     */
    private static function resolveRoutineTemplate(int $entityId, mixed $templateId, string $type): ?array
    {
        if ($templateId === null) {
            return null;
        }

        $id = Validate::id($templateId, 'templateId');

        $row = DB::table('documentTemplates')
            ->where('id', $id)->where('entityId', $entityId)->where('status', 'active')
            ->first(['id', 'version', 'category', 'fieldSchema']);

        if ($row === null || $row->category !== 'support_plan' || self::routineTypeOf($row->fieldSchema) !== $type) {
            throw TrpcException::badRequest('Select an active template for this care routine');
        }

        return ['id' => (int) $row->id, 'version' => (int) $row->version];
    }

    /** The routineType marker on a template's fieldSchema, when it carries one. */
    private static function routineTypeOf(mixed $fieldSchema): ?string
    {
        $schema = is_string($fieldSchema) ? json_decode($fieldSchema, true) : $fieldSchema;
        $type = is_array($schema) ? ($schema['routineType'] ?? null) : null;

        return is_string($type) && in_array($type, self::ROUTINE_TEMPLATE_TYPES, true) ? $type : null;
    }

    /** "did_not_attend" reads back as "did not attend". */
    private static function humanise(string $value): string
    {
        return str_replace('_', ' ', $value);
    }

    /** The keywork report rendered as the history feed's note body. */
    private static function reportBody(object $row): string
    {
        $lines = [];
        foreach ([
            'Mood' => $row->mood,
            'Attitude' => $row->attitude,
            'Learning' => $row->learning,
            'Enthusiasm' => $row->enthusiasm,
            'Discussion' => $row->discussions,
            'Next shift' => $row->pointsToNote,
            'Plan' => $row->plan,
            'Observations' => $row->suggestions,
        ] as $label => $value) {
            if (is_string($value) && $value !== '') {
                $lines[] = "$label: $value";
            }
        }

        return implode("\n", $lines);
    }
}
