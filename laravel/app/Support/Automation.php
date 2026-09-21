<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * The automation sweep, mirroring server/services/automation.ts.
 *
 * Walks everything in a company that has a deadline or is waiting on somebody,
 * and raises one notification per thing for the person who has to act. Where a
 * deadline has already passed by more than the rule's escalation window, the
 * same notification climbs the escalation route instead — a compliance record
 * nobody dealt with becomes the registered manager's, then the owner's.
 *
 * Two properties matter more than the breadth. It is keyed, so running it twice
 * refreshes what is outstanding rather than filling somebody's list with
 * duplicates. And it never closes anything: it says what is due, and a person
 * decides what to do.
 */
final class Automation
{
    private const DAY = 86400000;

    private const HOUR = 3600000;

    /**
     * The default policy per rule type. A company can override any of these
     * through an automationRules row, which is why they are defaults rather than
     * constants used directly.
     *
     * @var array<string, array<string, mixed>>
     */
    private const DEFAULTS = [
        'compliance' => ['leadDays' => 30, 'escalationDays' => 1, 'ownerRole' => 'registered_manager', 'escalationRoute' => ['registered_manager', 'owner'], 'requireAcknowledgement' => true, 'snoozeDays' => 3],
        'review' => ['leadDays' => 14, 'escalationDays' => 1, 'ownerRole' => 'registered_manager', 'escalationRoute' => ['registered_manager', 'owner'], 'requireAcknowledgement' => true, 'snoozeDays' => 3],
        'work_plan' => ['leadDays' => 7, 'escalationDays' => 1, 'ownerRole' => 'registered_manager', 'escalationRoute' => ['registered_manager', 'owner'], 'requireAcknowledgement' => true, 'snoozeDays' => 2],
        'policy' => ['leadDays' => 7, 'escalationDays' => 2, 'ownerRole' => 'registered_manager', 'escalationRoute' => ['registered_manager', 'owner'], 'requireAcknowledgement' => true, 'snoozeDays' => 2],
        'placement' => ['leadDays' => 14, 'escalationDays' => 1, 'ownerRole' => 'registered_manager', 'escalationRoute' => ['registered_manager', 'owner'], 'requireAcknowledgement' => true, 'snoozeDays' => 3],
        'invoice' => ['leadDays' => 7, 'escalationDays' => 3, 'ownerRole' => 'finance', 'escalationRoute' => ['finance', 'owner'], 'requireAcknowledgement' => true, 'snoozeDays' => 3],
        'evidence' => ['leadDays' => 30, 'escalationDays' => 1, 'ownerRole' => 'registered_manager', 'escalationRoute' => ['registered_manager', 'owner'], 'requireAcknowledgement' => true, 'snoozeDays' => 3],
    ];

    /** @var array<int, array<string, mixed>> */
    private array $rules = [];

    /** @var array<int, array<string, mixed>> */
    private array $candidates = [];

    /** @var array<int, array<int, object>> memberships per entity, read once */
    private array $membershipsByEntity = [];

    /** @var array<string, int> how many rows each source contributed */
    private array $evaluated = [];

    private function __construct(private readonly int $entityId, private readonly int $now)
    {
    }

    /**
     * @return array<string, mixed>
     */
    public static function run(int $entityId, ?int $nowMs = null): array
    {
        $engine = new self($entityId, $nowMs ?? Dates::nowMillis());

        $engine->loadRules();
        $engine->collectDeadlines();
        $engine->collectFrontline();
        $engine->collectEvidence();

        $created = $engine->raiseNotifications();

        // The coverage and renewal sweeps are separate engines with their own
        // rules; the manual run pulls them along so one button means "check
        // everything".
        $coverage = RotaCoverage::evaluate([
            'entityId' => $entityId,
            'from' => RotaOverview::operationalDayStart($engine->now),
            'to' => RotaOverview::operationalDayStart($engine->now) + 31 * self::DAY,
            'actorType' => 'scheduled_job',
        ]);

        $renewals = ComplianceRenewals::run($entityId, $engine->now);

        return [
            'evaluated' => array_sum($engine->evaluated) + $coverage['evaluatedDays'] + $renewals['evaluated'],
            'notificationsUpserted' => $created + $coverage['notificationsUpserted'] + $renewals['notificationsUpserted'],
            'rotaCoverage' => $coverage,
            'renewalCandidates' => $renewals['candidates'],
            'emailOutboxUpserted' => $renewals['outboxUpserted'],
            'emailProviderActive' => $renewals['emailProviderActive'],
        ];
    }

    private function loadRules(): void
    {
        foreach (DB::table('automationRules')
            ->where('entityId', $this->entityId)->where('enabled', 1)->get() as $rule) {
            $this->rules[] = [
                'ruleType' => (string) $rule->ruleType,
                'configuration' => is_string($rule->configuration)
                    ? (json_decode($rule->configuration, true) ?? [])
                    : ((array) ($rule->configuration ?? [])),
            ];
        }
    }

    /** The policy for a rule type: the defaults, with any company override on top. */
    private function policy(string $type): array
    {
        foreach ($this->rules as $rule) {
            if ($rule['ruleType'] === $type) {
                return array_merge(self::DEFAULTS[$type], $rule['configuration']);
            }
        }

        return self::DEFAULTS[$type];
    }

    /** The evidence rule's own configuration, or null when the company has none. */
    private function evidenceConfig(): ?array
    {
        foreach ($this->rules as $rule) {
            if ($rule['ruleType'] === 'evidence') {
                return $rule['configuration'];
            }
        }

        return null;
    }

    /** Everything with a date on it: obligations, actions, plans, placements, policies, invoices. */
    private function collectDeadlines(): void
    {
        $obligations = $this->rows('complianceObligations');
        $config = $this->policy('compliance');

        foreach ($obligations as $item) {
            if (in_array($item->status, ['complete', 'not_applicable'], true)) {
                continue;
            }

            $leadDays = (int) $item->leadDays ?: (int) $config['leadDays'];
            $rag = Rules::ragStatus(
                $item->dueAt === null ? null : (int) $item->dueAt,
                $item->completedAt === null ? null : (int) $item->completedAt,
                $leadDays,
                $this->now,
            );
            $status = match ($rag) {
                'red' => 'overdue',
                'amber' => 'due_soon',
                default => 'not_due',
            };

            // The row's own status is refreshed even when nothing is raised, so
            // the register on screen agrees with the alerts.
            DB::table('complianceObligations')->where('id', $item->id)
                ->update(['status' => $status, 'ragStatus' => $rag]);

            if ($status === 'not_due') {
                continue;
            }

            $this->add($config, [
                'userId' => $item->ownerUserId === null ? null : (int) $item->ownerUserId,
                'type' => 'compliance',
                'title' => (string) $item->title,
                'message' => $status === 'overdue'
                    ? 'Compliance evidence is overdue and requires action.'
                    : "Compliance evidence is due within $leadDays days.",
                'severity' => $status === 'overdue' ? 'urgent' : 'warning',
                'resourceType' => 'compliance_obligation',
                'resourceId' => (int) $item->id,
                'deepLink' => '/compliance?record=' . (int) $item->id,
                'dueAt' => (int) $item->dueAt,
                'dedupeKey' => 'compliance:' . (int) $item->id,
            ]);
        }

        $config = $this->policy('work_plan');
        foreach ($this->rows('workPlanActions') as $item) {
            if (in_array($item->status, ['complete', 'cancelled'], true)
                || (int) $item->dueAt > $this->now + (int) $config['leadDays'] * self::DAY) {
                continue;
            }

            $overdue = Rules::classifyDeadline((int) $item->dueAt, (int) $config['leadDays'], $this->now) === 'overdue';

            $this->add($config, [
                'userId' => $item->ownerUserId === null ? null : (int) $item->ownerUserId,
                'type' => 'work_plan',
                'title' => (string) $item->title,
                'message' => $overdue
                    ? 'Work-plan action is overdue.'
                    : "Work-plan action is due within {$config['leadDays']} days.",
                'severity' => $overdue ? 'urgent' : 'warning',
                'resourceType' => 'work_plan_action',
                'resourceId' => (int) $item->id,
                'deepLink' => '/work-plans?record=' . (int) $item->id,
                'dueAt' => (int) $item->dueAt,
                'dedupeKey' => 'work-plan:' . (int) $item->id,
            ]);
        }

        $config = $this->policy('review');
        foreach ($this->rows('carePlans') as $item) {
            // Only an approved plan has a review to be late for; a draft is
            // somebody's work in progress.
            if ($item->status !== 'approved'
                || $item->reviewDueAt === null
                || (int) $item->reviewDueAt > $this->now + (int) $config['leadDays'] * self::DAY) {
                continue;
            }

            $overdue = (int) $item->reviewDueAt < $this->now;

            $this->add($config, [
                'type' => 'plan_review',
                'title' => str_replace('_', ' ', (string) $item->planType) . ' plan review',
                'message' => $overdue
                    ? 'Approved plan review is overdue.'
                    : "Approved plan review is due within {$config['leadDays']} days.",
                'severity' => $overdue ? 'urgent' : 'warning',
                'resourceType' => 'care_plan',
                'resourceId' => (int) $item->id,
                'deepLink' => '/placements?plan=' . (int) $item->id,
                'dueAt' => (int) $item->reviewDueAt,
                'dedupeKey' => 'plan:' . (int) $item->id,
            ]);
        }

        $config = $this->policy('placement');
        foreach ($this->rows('placements') as $item) {
            if ($item->reviewDueAt === null
                || in_array($item->status, ['ended', 'declined'], true)
                || (int) $item->reviewDueAt > $this->now + (int) $config['leadDays'] * self::DAY) {
                continue;
            }

            $overdue = (int) $item->reviewDueAt < $this->now;

            $this->add($config, [
                'type' => 'placement_review',
                'title' => 'Placement review',
                'message' => $overdue
                    ? 'Placement review is overdue.'
                    : "Placement review is due within {$config['leadDays']} days.",
                'severity' => $overdue ? 'urgent' : 'warning',
                'resourceType' => 'placement',
                'resourceId' => (int) $item->id,
                'deepLink' => '/placements?record=' . (int) $item->id,
                'dueAt' => (int) $item->reviewDueAt,
                'dedupeKey' => 'placement:' . (int) $item->id,
            ]);
        }

        $config = $this->policy('policy');
        foreach ($this->rows('policyAcknowledgements') as $item) {
            if ($item->status === 'acknowledged'
                || $item->dueAt === null
                || (int) $item->dueAt > $this->now + (int) $config['leadDays'] * self::DAY) {
                continue;
            }

            $overdue = (int) $item->dueAt < $this->now;

            $this->add($config, [
                // A policy acknowledgement belongs to the person who has to make
                // it, not to a manager.
                'userId' => (int) $item->userId,
                'type' => 'policy',
                'title' => 'Policy acknowledgement',
                'message' => $overdue
                    ? 'Policy acknowledgement is overdue.'
                    : "Policy acknowledgement is due within {$config['leadDays']} days.",
                'severity' => $overdue ? 'urgent' : 'warning',
                'resourceType' => 'policy_acknowledgement',
                'resourceId' => (int) $item->id,
                'deepLink' => '/documents?ack=' . (int) $item->id,
                'dueAt' => (int) $item->dueAt,
                'dedupeKey' => 'policy:' . (int) $item->id,
            ]);
        }

        $config = $this->policy('invoice');
        foreach ($this->rows('invoices') as $item) {
            if ($item->dueAt === null
                || in_array($item->status, ['paid', 'void', 'credited', 'draft', 'pending_approval'], true)
                || (int) $item->dueAt > $this->now + (int) $config['leadDays'] * self::DAY) {
                continue;
            }

            $overdue = (int) $item->dueAt < $this->now;

            // An invoice past its date is marked overdue on the invoice itself,
            // because finance reads the invoice list rather than the alerts.
            if ($overdue && in_array($item->status, ['issued', 'sent', 'part_paid'], true)) {
                DB::table('invoices')->where('id', $item->id)->update(['status' => 'overdue']);
            }

            $this->add($config, [
                'type' => 'invoice',
                'title' => $item->invoiceNumber === null ? 'Invoice payment' : 'Invoice ' . $item->invoiceNumber,
                'message' => $overdue
                    ? 'Invoice payment is overdue.'
                    : "Invoice payment is due within {$config['leadDays']} days.",
                'severity' => $overdue ? 'urgent' : 'warning',
                'resourceType' => 'invoice',
                'resourceId' => (int) $item->id,
                'deepLink' => '/finance/invoice/' . (int) $item->id,
                'dueAt' => (int) $item->dueAt,
                'dedupeKey' => 'invoice:' . (int) $item->id,
            ]);
        }
    }

    /**
     * The things a shift leaves behind: a curfew check nobody made, a lone
     * worker who has not checked in, a visitor still on site, a record waiting
     * on a manager. These all run on the work_plan policy, because they are all
     * "somebody has to deal with this today".
     */
    private function collectFrontline(): void
    {
        $config = $this->policy('work_plan');

        foreach ($this->rows('curfewChecks') as $item) {
            if ($item->status !== 'pending' || (int) $item->expectedAt > $this->now) {
                continue;
            }

            $this->add($config, [
                'type' => 'curfew',
                'title' => 'Curfew check overdue',
                'message' => 'A scheduled curfew check requires action in the Hub.',
                'severity' => (int) $item->escalationRequired === 1 ? 'urgent' : 'warning',
                'resourceType' => 'curfew_check',
                'resourceId' => (int) $item->id,
                'deepLink' => '/app/people',
                'dueAt' => (int) $item->expectedAt,
                'dedupeKey' => 'curfew:' . (int) $item->id,
            ]);
        }

        foreach ($this->rows('loneWorkerSessions') as $item) {
            if (!in_array($item->status, ['active', 'overdue'], true)
                || (int) $item->nextCheckInDueAt > $this->now) {
                continue;
            }

            // The session is moved to overdue as well as alerted on: somebody
            // looking at the session list has to see it too.
            if ($item->status === 'active') {
                DB::table('loneWorkerSessions')->where('id', $item->id)
                    ->update(['status' => 'overdue', 'version' => (int) $item->version + 1]);
            }

            $this->add($config, [
                'type' => 'lone_worker',
                'title' => 'Lone-worker check-in overdue',
                'message' => 'A lone-worker safety check-in is overdue. Open the Hub to respond.',
                // Always urgent: this is somebody working alone who has not
                // answered.
                'severity' => 'urgent',
                'resourceType' => 'lone_worker_session',
                'resourceId' => (int) $item->id,
                'deepLink' => '/app/property',
                'dueAt' => (int) $item->nextCheckInDueAt,
                'dedupeKey' => 'lone-worker:' . (int) $item->id,
            ]);
        }

        foreach ($this->rows('propertyVisitors') as $item) {
            if ($item->status !== 'on_site'
                || $item->expectedDepartureAt === null
                || (int) $item->expectedDepartureAt > $this->now) {
                continue;
            }

            $this->add($config, [
                'type' => 'visitor',
                'title' => 'Visitor departure overdue',
                'message' => 'A visitor remains recorded on site after the expected departure time.',
                'severity' => 'warning',
                'resourceType' => 'property_visitor',
                'resourceId' => (int) $item->id,
                'deepLink' => '/app/property',
                'dueAt' => (int) $item->expectedDepartureAt,
                'dedupeKey' => 'visitor:' . (int) $item->id,
            ]);
        }

        foreach ($this->rows('medicationDiscrepancies') as $item) {
            if ($item->status === 'closed') {
                continue;
            }

            $dueAt = $this->createdAtMillis($item) + self::DAY;

            $this->add($config, [
                'type' => 'medication',
                'title' => 'Medication review required',
                'message' => 'A medication discrepancy requires Manager review.',
                'severity' => $dueAt <= $this->now ? 'urgent' : 'warning',
                'resourceType' => 'medication_discrepancy',
                'resourceId' => (int) $item->id,
                'deepLink' => '/app/manager/inbox',
                'dueAt' => $dueAt,
                'dedupeKey' => 'medication-discrepancy:' . (int) $item->id,
            ]);
        }

        foreach ($this->rows('residentFinanceDiscrepancies') as $item) {
            if ($item->status === 'closed') {
                continue;
            }

            $dueAt = $this->createdAtMillis($item) + self::DAY;

            $this->add($config, [
                'type' => 'resident_finance',
                'title' => 'Resident-finance review required',
                'message' => 'A resident-finance discrepancy requires Manager review.',
                // Money taken without authority is a different thing from a
                // till that does not balance.
                'severity' => $item->discrepancyType === 'unauthorised' ? 'urgent' : 'warning',
                'resourceType' => 'resident_finance_discrepancy',
                'resourceId' => (int) $item->id,
                'deepLink' => '/app/manager/inbox',
                'dueAt' => $dueAt,
                'dedupeKey' => 'resident-finance-discrepancy:' . (int) $item->id,
            ]);
        }

        foreach ($this->rows('keyWorkerReports') as $item) {
            if (!in_array($item->status, ['submitted', 'reviewed'], true)) {
                continue;
            }

            $dueAt = $this->createdAtMillis($item) + self::DAY;

            $this->add($config, [
                'type' => 'keywork_report',
                'title' => 'Keyworker report awaiting review',
                'message' => 'A submitted report requires Manager review.',
                'severity' => $dueAt <= $this->now ? 'urgent' : 'warning',
                'resourceType' => 'key_worker_report',
                'resourceId' => (int) $item->id,
                'deepLink' => '/app/manager/inbox',
                'dueAt' => $dueAt,
                'dedupeKey' => 'keywork-report:' . (int) $item->id,
            ]);
        }

        foreach ($this->rows('incidents') as $item) {
            if (!in_array($item->managerReviewState, ['pending', 'in_review'], true)) {
                continue;
            }

            $dueAt = $item->notificationDueAt === null
                ? $this->createdAtMillis($item) + self::DAY
                : (int) $item->notificationDueAt;

            $this->add($config, [
                'type' => 'incident_review',
                'title' => 'Incident review required',
                'message' => 'An incident requires Manager assessment in the Hub.',
                'severity' => $item->severity === 'critical' || $dueAt <= $this->now ? 'urgent' : 'warning',
                'resourceType' => 'incident',
                'resourceId' => (int) $item->id,
                'deepLink' => '/app/manager/inbox',
                'dueAt' => $dueAt,
                'dedupeKey' => 'incident-review:' . (int) $item->id,
            ]);
        }

        foreach ($this->rows('propertyChecks') as $item) {
            if ($item->status !== 'submitted') {
                continue;
            }

            $dueAt = $item->completedAt === null
                ? $this->createdAtMillis($item) + self::DAY
                : (int) $item->completedAt;

            $this->add($config, [
                'type' => 'property_check',
                'title' => 'Property check awaiting review',
                'message' => 'A submitted property or room check requires Manager review.',
                'severity' => $item->result === 'urgent_action' ? 'urgent' : 'warning',
                'resourceType' => 'property_check',
                'resourceId' => (int) $item->id,
                'deepLink' => '/app/manager/inbox',
                'dueAt' => $dueAt,
                'dedupeKey' => 'property-check:' . (int) $item->id,
            ]);
        }

        foreach ($this->rows('supervisionSessions') as $item) {
            if (!in_array($item->status, ['scheduled', 'submitted'], true)
                || (int) $item->scheduledAt > $this->now) {
                continue;
            }

            $this->add($config, [
                'userId' => (int) $item->managerUserId,
                'type' => 'supervision',
                'title' => 'Supervision action required',
                'message' => 'A supervision session requires action in the Hub.',
                'severity' => (int) $item->scheduledAt + 7 * self::DAY <= $this->now ? 'urgent' : 'warning',
                'resourceType' => 'supervision_session',
                'resourceId' => (int) $item->id,
                'deepLink' => '/app/more',
                'dueAt' => (int) $item->scheduledAt,
                'dedupeKey' => 'supervision:' . (int) $item->id,
            ]);
        }

        foreach ($this->rows('maintenanceJobs') as $item) {
            if (!in_array($item->priority, ['urgent', 'emergency'], true)
                || in_array($item->status, ['verified', 'cancelled'], true)) {
                continue;
            }

            // An emergency gets an hour before it is urgent; anything else a day.
            $dueAt = $item->targetAt === null
                ? $this->createdAtMillis($item) + ($item->priority === 'emergency' ? self::HOUR : self::DAY)
                : (int) $item->targetAt;

            $this->add($config, [
                'type' => 'maintenance',
                'title' => 'Urgent maintenance action',
                'message' => 'An urgent maintenance record requires action in the Hub.',
                'severity' => $item->priority === 'emergency' || $dueAt <= $this->now ? 'urgent' : 'warning',
                'resourceType' => 'maintenance_job',
                'resourceId' => (int) $item->id,
                'deepLink' => '/app/property',
                'dueAt' => $dueAt,
                'dedupeKey' => 'maintenance:' . (int) $item->id,
            ]);
        }

        foreach ($this->rows('safeguardingConcerns') as $item) {
            if ($item->status === 'closed') {
                continue;
            }

            $dueAt = $item->reviewDueAt === null
                ? $this->createdAtMillis($item) + self::DAY
                : (int) $item->reviewDueAt;

            $this->add($config, [
                'type' => 'safeguarding',
                'title' => 'Safeguarding review required',
                'message' => 'A safeguarding concern requires restricted Manager action in the Hub.',
                'severity' => in_array($item->riskLevel, ['high', 'critical'], true) || $dueAt <= $this->now
                    ? 'urgent'
                    : 'warning',
                'resourceType' => 'safeguarding_concern',
                'resourceId' => (int) $item->id,
                'deepLink' => '/app/manager/inbox',
                'dueAt' => $dueAt,
                'dedupeKey' => 'safeguarding:' . (int) $item->id,
            ]);
        }
    }

    /**
     * Staff evidence, document reviews and retention reviews.
     *
     * These only run where the company has configured an evidence rule: without
     * one there is no agreed review window, and inventing one would put dates on
     * a manager's list that nobody signed up to.
     */
    private function collectEvidence(): void
    {
        $evidence = $this->evidenceConfig();
        $frontline = $this->policy('work_plan');
        $evidencePolicy = $this->policy('evidence');

        foreach ($this->rows('staffRequests') as $item) {
            if ($item->status !== 'submitted') {
                continue;
            }

            $isEvidence = in_array($item->requestType, ['certificate_submission', 'sickness'], true);
            $configured = $isEvidence && $evidence !== null;

            $reviewHours = $configured
                ? max(1, min(720, (int) ($evidence['staffEvidenceReviewHours'] ?? 48)))
                : 48;
            $dueAt = $this->createdAtMillis($item) + $reviewHours * self::HOUR;

            $this->add($configured ? $evidencePolicy : $frontline, [
                'type' => $configured ? 'evidence_review' : 'staff_request',
                'title' => $isEvidence ? 'Workforce evidence awaiting review' : 'Staff request awaiting review',
                'message' => $isEvidence
                    ? 'Certificate or sickness evidence is awaiting independent Manager review.'
                    : 'A staff self-service request is awaiting Manager review.',
                'severity' => $dueAt <= $this->now ? 'urgent' : 'warning',
                'resourceType' => 'staff_request',
                'resourceId' => (int) $item->id,
                'deepLink' => '/manager-app',
                'dedupeKey' => ($configured ? 'evidence-review' : 'staff-request') . ':' . (int) $item->id,
                'dueAt' => $dueAt,
            ]);
        }

        if ($evidence === null) {
            // The document and retention sweeps exist only under a configured
            // evidence rule, so the rows are not even counted without one.
            return;
        }

        $documentLead = max(1, min(365, (int) ($evidence['documentReviewLeadDays'] ?? 30)));
        foreach ($this->rows('documents') as $item) {
            if ($item->status === 'archived'
                || $item->reviewDueAt === null
                || (int) $item->reviewDueAt > $this->now + $documentLead * self::DAY) {
                continue;
            }

            $overdue = (int) $item->reviewDueAt <= $this->now;

            $this->add($evidencePolicy, [
                'type' => 'document_review',
                'title' => 'Document review due',
                'message' => $overdue
                    ? 'A controlled document review is overdue.'
                    : "A controlled document review is due within $documentLead days.",
                'severity' => $overdue ? 'urgent' : 'warning',
                'resourceType' => 'document',
                'resourceId' => (int) $item->id,
                'deepLink' => '/documents',
                'dueAt' => (int) $item->reviewDueAt,
                'dedupeKey' => 'document-review:' . (int) $item->id,
            ]);
        }

        $retentionLead = max(1, min(365, (int) ($evidence['retentionReviewLeadDays'] ?? 30)));
        foreach ($this->rows('retentionReviews') as $item) {
            // A record under legal hold is not up for a retention decision,
            // whatever its date says.
            if ($item->status !== 'pending'
                || (int) $item->legalHold === 1
                || (int) $item->reviewDueAt > $this->now + $retentionLead * self::DAY) {
                continue;
            }

            $overdue = (int) $item->reviewDueAt <= $this->now;

            $this->add($evidencePolicy, [
                'type' => 'retention_review',
                'title' => 'Retention review due',
                'message' => $overdue
                    ? 'A retention review is overdue.'
                    : "A retention review is due within $retentionLead days.",
                'severity' => $overdue ? 'urgent' : 'warning',
                'resourceType' => 'retention_review',
                'resourceId' => (int) $item->id,
                'deepLink' => '/documents',
                'dueAt' => (int) $item->reviewDueAt,
                'dedupeKey' => 'retention-review:' . (int) $item->id,
            ]);
        }
    }

    /**
     * Turns a candidate into an owner, a notification and, where it has climbed
     * a stage, an audit entry.
     */
    private function raiseNotifications(): int
    {
        $created = 0;

        foreach ($this->candidates as $item) {
            $owner = $item['userId'] ?? $this->fallbackOwner($item['ownerRole']);
            if ($owner === null) {
                continue;
            }

            $previous = DB::table('notifications')
                ->where('userId', $owner)->where('dedupeKey', $item['dedupeKey'])
                ->first(['id', 'escalationCount']);

            DB::table('notifications')->upsert(
                [[
                    'entityId' => $this->entityId,
                    'userId' => $owner,
                    'type' => $item['type'],
                    'title' => $item['title'],
                    'message' => $item['message'],
                    'severity' => $item['severity'],
                    'resourceType' => $item['resourceType'],
                    'resourceId' => $item['resourceId'],
                    'deepLink' => $item['deepLink'],
                    'dueAt' => $item['dueAt'],
                    'acknowledgementRequired' => $item['acknowledgementRequired'],
                    'escalationDueAt' => $item['escalationDueAt'],
                    'escalationState' => $item['escalationState'],
                    'escalationCount' => $item['escalationCount'],
                    'dedupeKey' => $item['dedupeKey'],
                ]],
                ['userId', 'dedupeKey'],
                // resolvedAt is cleared: something marked done that is due again
                // is outstanding again.
                [
                    'title', 'message', 'severity', 'deepLink', 'dueAt', 'acknowledgementRequired',
                    'escalationDueAt', 'escalationState', 'escalationCount', 'resolvedAt',
                ],
            );

            $previousCount = $previous === null ? 0 : (int) $previous->escalationCount;

            // A reminder is recorded against the invoice itself, so the payment
            // history shows what was chased and when.
            if ($item['resourceType'] === 'invoice' && ($previous === null || $item['escalationCount'] > $previousCount)) {
                DB::table('invoiceEvents')->insert([
                    'entityId' => $this->entityId,
                    'invoiceId' => $item['resourceId'],
                    'eventType' => 'reminded',
                    'occurredAt' => $this->now,
                    'metadata' => json_encode([
                        'ownerUserId' => $owner,
                        'stage' => $item['escalationCount'],
                        'severity' => $item['severity'],
                        'dueAt' => $item['dueAt'],
                    ], JSON_UNESCAPED_SLASHES),
                ]);
            }

            // Only the climb is audited, not every sweep: the trail should show
            // that something went unanswered, not that a cron ran.
            if ($item['escalationCount'] > $previousCount) {
                Audit::write([
                    'actorType' => 'scheduled_job',
                    'entityId' => $this->entityId,
                    'action' => 'notification.escalate',
                    'resourceType' => $item['resourceType'],
                    'resourceId' => $item['resourceId'],
                    'result' => 'success',
                    'reasonCode' => 'stage:' . $item['escalationCount'],
                    'metadata' => [
                        'notificationId' => $previous === null ? null : (int) $previous->id,
                        'ownerUserId' => $owner,
                        'ownerRole' => $item['ownerRole'],
                        'escalationDueAt' => $item['escalationDueAt'],
                    ],
                ]);
            }

            $created++;
        }

        return $created;
    }

    /**
     * Works out the escalation state of one candidate and queues it.
     *
     * @param array<string, mixed> $config
     * @param array<string, mixed> $input
     */
    private function add(array $config, array $input): void
    {
        $escalationDays = max(1, (int) $config['escalationDays']);
        $escalationDueAt = $input['dueAt'] + (int) $config['escalationDays'] * self::DAY;
        $escalated = $this->now >= $escalationDueAt;

        // How many escalation windows have passed, which is also how far up the
        // route this has climbed.
        $escalationCount = $escalated
            ? max(1, (int) floor(($this->now - $input['dueAt']) / ($escalationDays * self::DAY)))
            : 0;

        $route = $config['escalationRoute'];
        $ownerRole = $escalated
            ? ($route[min($escalationCount - 1, count($route) - 1)] ?? $config['ownerRole'])
            : $config['ownerRole'];

        $this->candidates[] = $input + [
            'userId' => null,
            'ownerRole' => $ownerRole,
            'acknowledgementRequired' => $config['requireAcknowledgement'] ? 1 : 0,
            'escalationDueAt' => $escalationDueAt,
            'escalationState' => $escalated ? 'escalated' : 'none',
            'escalationCount' => $escalationCount,
        ];
    }

    /**
     * Whoever holds the role this should reach, falling back through the route
     * so an unowned item still lands with a person.
     */
    private function fallbackOwner(?string $preferredRole): ?int
    {
        if ($this->membershipsByEntity === []) {
            $this->membershipsByEntity[$this->entityId] = DB::table('entityMemberships')
                ->where('entityId', $this->entityId)->where('status', 'active')
                ->get(['userId', 'operationalRole'])->all();
        }

        $memberships = $this->membershipsByEntity[$this->entityId];

        foreach ([$preferredRole, 'registered_manager', 'owner'] as $role) {
            if ($role === null) {
                continue;
            }
            foreach ($memberships as $membership) {
                if ($membership->operationalRole === $role) {
                    return (int) $membership->userId;
                }
            }
        }

        return null;
    }

    /**
     * Every row of a table for this company, counted towards "evaluated".
     *
     * Node read each table globally and filtered in memory, and for the
     * frontline tables it counted the unfiltered totals. Here everything is
     * scoped to the company being swept, so the count reports what this run
     * actually looked at.
     *
     * @return \Illuminate\Support\Collection<int, object>
     */
    private function rows(string $table)
    {
        $rows = DB::table($table)->where('entityId', $this->entityId)->get();
        $this->evaluated[$table] = $rows->count();

        return $rows;
    }

    /** createdAt is a MySQL timestamp on these tables rather than a millisecond column. */
    private function createdAtMillis(object $row): int
    {
        $date = Dates::fromDatabase($row->createdAt ?? null);

        return $date === null ? $this->now : (int) ($date->getTimestamp() * 1000);
    }
}
