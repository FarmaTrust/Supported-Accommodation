<?php

declare(strict_types=1);

namespace App\Trpc\Routers;

use App\Support\Audit;
use App\Support\Authz;
use App\Support\Dates;
use App\Support\EncryptedFields;
use App\Trpc\Context;
use App\Trpc\Registry;
use App\Trpc\TrpcException;
use App\Trpc\Validate;
use Illuminate\Support\Facades\DB;

/**
 * safeguarding.*, mirroring server/routers/safeguarding.ts.
 *
 * Complaints, allegations against staff, missing episodes, restraint and
 * behaviour support. These are the records an inspector reads first and the
 * ones a provider is most tempted to tidy, so the pattern throughout is that
 * the person who recorded an event is not the person who closes it:
 *
 *   complaint outcome      not the person who raised it
 *   allegation closure     not the person who raised it
 *   return interview       not the person who recorded the return
 *   restraint review       not the person who was in the restraint
 *   behaviour review       not the person who wrote the event
 *
 * Every narrative field is encrypted at rest, and the workspace returns only
 * the one summary field each record type shows on screen.
 */
final class SafeguardingRouter
{
    private const DAY_MS = 86400000;

    private const COMPLAINANT_TYPES = [
        'young_person', 'family_advocate', 'professional', 'staff', 'neighbour', 'anonymous', 'other',
    ];
    private const COMPLAINT_CATEGORIES = [
        'quality', 'staff_conduct', 'safeguarding', 'property', 'privacy', 'finance', 'discrimination', 'other',
    ];
    private const CONSENT_STATES = ['given', 'not_given', 'not_required', 'unable', 'unknown'];
    private const COMPLAINT_OUTCOMES = ['upheld', 'partially_upheld', 'not_upheld', 'withdrawn', 'unresolved'];
    private const ESCALATION_TARGETS = [
        'owner', 'registered_manager', 'responsible_individual', 'local_authority', 'ofsted', 'ombudsman', 'other',
    ];

    private const PERSON_CONCERN_TYPES = ['staff', 'agency', 'volunteer', 'professional', 'other'];
    private const ALLEGATION_TYPES = ['harm', 'possible_offence', 'suitability', 'position_of_trust', 'policy_breach', 'other'];
    private const ALLEGATION_OUTCOMES = [
        'substantiated', 'unsubstantiated', 'unfounded', 'malicious', 'false', 'no_further_action', 'other',
    ];
    private const LADO_DECISIONS = [
        'not_contacted', 'pending', 'strategy_discussion', 'employer_action', 'police_investigation', 'no_further_action', 'other',
    ];
    private const POLICE_DECISIONS = ['not_contacted', 'pending', 'investigating', 'no_further_action', 'charged', 'other'];
    private const OFSTED_DECISIONS = ['unreviewed', 'not_notifiable', 'notify', 'submitted'];

    private const RISK_LEVELS = ['low', 'medium', 'high', 'critical'];
    private const RETURN_METHODS = ['self_return', 'police', 'staff', 'family', 'authority', 'found', 'other'];

    private const INTERVENTION_TYPES = ['physical', 'environmental', 'withdrawal', 'other'];
    private const MEDICAL_ATTENTION = ['none', 'first_aid', 'nhs_111', 'ambulance', 'a_and_e', 'gp', 'other'];
    private const MANAGEMENT_REVIEWS = ['appropriate', 'learning_required', 'concern', 'escalated'];

    private const EFFECTIVENESS = ['effective', 'partly_effective', 'not_effective', 'unclear'];
    private const BEHAVIOUR_REVIEW_OUTCOMES = [
        'plan_effective', 'plan_update_required', 'multi_agency_review', 'closed_no_change',
    ];

    public static function register(Registry $registry): void
    {
        $registry->query('safeguarding.workspace', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'incident.review');

            $propertyIds = Authz::accessiblePropertyIds($ctx->userId(), $entityId, 'property.read');

            // A record with no property is company-wide and stays visible; one
            // attached to a property the reader cannot reach does not.
            $scoped = static function (iterable $rows, array $fields, bool $requireProperty) use ($propertyIds): array {
                $out = [];
                foreach ($rows as $row) {
                    $propertyId = $row->propertyId === null ? null : (int) $row->propertyId;
                    if ($propertyId === null ? $requireProperty : !in_array($propertyId, $propertyIds, true)) {
                        continue;
                    }
                    $out[] = EncryptedFields::reveal((array) $row, $fields);
                }

                return $out;
            };

            $allegations = [];
            foreach ($scoped(
                DB::table('allegations')->where('entityId', $entityId)->orderByDesc('createdAt')->get(),
                ['neutralSummary'],
                false,
            ) as $record) {
                // The client reads one "summary" field whatever the record type,
                // and for an allegation that is the neutral summary.
                $record['summary'] = $record['neutralSummary'];
                unset($record['neutralSummary']);
                $allegations[] = $record;
            }

            return [
                'placements' => $propertyIds === [] ? [] : DB::table('placements as pl')
                    ->join('youngPeople as yp', 'yp.id', '=', 'pl.youngPersonId')
                    ->leftJoin('properties as pr', 'pr.id', '=', 'pl.propertyId')
                    ->where('pl.entityId', $entityId)
                    ->whereIn('pl.propertyId', $propertyIds)
                    ->select(['pl.id', 'pl.propertyId', 'yp.reference', 'pr.name as propertyName'])
                    ->get()->map(static fn ($r) => (array) $r)->all(),
                'complaints' => $scoped(
                    DB::table('complaints')->where('entityId', $entityId)->orderByDesc('receivedAt')->get(),
                    ['summary'],
                    false,
                ),
                'allegations' => $allegations,
                'missing' => $scoped(
                    DB::table('missingEpisodes')->where('entityId', $entityId)->orderByDesc('missingAt')->get(),
                    ['circumstances'],
                    true,
                ),
                'restraints' => $scoped(
                    DB::table('restraintEvents')->where('entityId', $entityId)->orderByDesc('startedAt')->get(),
                    ['necessity'],
                    true,
                ),
                'behaviour' => $scoped(
                    DB::table('behaviourSupportEvents')->where('entityId', $entityId)->orderByDesc('occurredAt')->get(),
                    ['behaviour'],
                    true,
                ),
            ];
        });

        $registry->mutation('safeguarding.createComplaint', Registry::USER, static function (Context $ctx, mixed $input): array {
            [$entityId, $placement] = self::placementGuard($ctx, $input);
            $now = Dates::nowMillis();

            $id = (int) DB::table('complaints')->insertGetId([
                'entityId' => $entityId,
                'propertyId' => (int) $placement['propertyId'],
                'placementId' => (int) $placement['id'],
                'complainantType' => Validate::enum($input['complainantType'] ?? null, self::COMPLAINANT_TYPES, 'complainantType'),
                'consentState' => Validate::enum($input['consentState'] ?? 'unknown', self::CONSENT_STATES, 'consentState'),
                'category' => Validate::enum($input['category'] ?? null, self::COMPLAINT_CATEGORIES, 'category'),
                'summaryCiphertext' => EncryptedFields::seal(Validate::string($input['summary'] ?? null, 'summary', 20, 8000)),
                'receivedAt' => $now,
                // 20 working days is the statutory response window; it is set at
                // creation so the overdue list does not depend on anybody
                // remembering to enter a date.
                'responseDueAt' => $now + 20 * self::DAY_MS,
                'createdBy' => $ctx->userId(),
            ]);

            return ['id' => $id];
        });

        $registry->mutation('safeguarding.escalateComplaint', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::assertReviewer($ctx, $input);
            $complaint = self::findOwned('complaints', $input['complaintId'] ?? null, 'complaintId', $entityId, 'Complaint not found');

            $targetType = Validate::enum($input['targetType'] ?? null, self::ESCALATION_TARGETS, 'targetType');
            $targetName = Validate::optionalString($input['targetName'] ?? null, 'targetName', 220);

            $id = (int) DB::table('complaintEscalations')->insertGetId([
                'entityId' => $entityId,
                'complaintId' => (int) $complaint->id,
                'fromUserId' => $ctx->userId(),
                'targetType' => $targetType,
                'targetName' => $targetName,
                'reasonCiphertext' => EncryptedFields::seal(Validate::string($input['reason'] ?? null, 'reason', 20, 6000)),
                'dueAt' => Validate::optionalInt($input['dueAt'] ?? null, 'dueAt') ?? Dates::nowMillis() + 10 * self::DAY_MS,
            ]);

            DB::table('complaints')->where('id', $complaint->id)->update([
                'stage' => 'external',
                'status' => 'escalated',
                'escalationTarget' => $targetName ?? $targetType,
            ]);

            return ['id' => $id];
        });

        $registry->mutation('safeguarding.respondComplaint', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::assertReviewer($ctx, $input);
            $complaint = self::findOwned('complaints', $input['complaintId'] ?? null, 'complaintId', $entityId, 'Complaint not found');

            // The person a complaint was raised with does not get to record
            // whether it was upheld.
            self::refuseSameHand(
                (int) $complaint->createdBy === $ctx->userId(),
                'A different manager must record the complaint outcome',
            );

            DB::table('complaints')->where('id', $complaint->id)->update([
                'outcome' => Validate::enum($input['outcome'] ?? null, self::COMPLAINT_OUTCOMES, 'outcome'),
                'responseCiphertext' => EncryptedFields::seal(Validate::string($input['response'] ?? null, 'response', 20, 8000)),
                'learningCiphertext' => EncryptedFields::seal(Validate::string($input['learning'] ?? null, 'learning', 10, 8000)),
                'stage' => 'closed',
                'status' => 'closed',
                'closedAt' => Dates::nowMillis(),
            ]);

            return ['success' => true];
        });

        $registry->mutation('safeguarding.createAllegation', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::assertReviewer($ctx, $input);

            $placementId = Validate::optionalId($input['placementId'] ?? null, 'placementId');
            $propertyId = Validate::optionalId($input['propertyId'] ?? null, 'propertyId');

            // Where a placement is named, the property comes from the placement
            // rather than from the request.
            if ($placementId !== null) {
                [, $placement] = self::placementGuard($ctx, $input);
                $propertyId = (int) $placement['propertyId'];
            }

            $id = (int) DB::table('allegations')->insertGetId([
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'placementId' => $placementId,
                'personConcernType' => Validate::enum($input['personConcernType'] ?? null, self::PERSON_CONCERN_TYPES, 'personConcernType'),
                'personConcernCiphertext' => EncryptedFields::seal(
                    Validate::optionalString($input['personConcern'] ?? null, 'personConcern', 3000),
                ),
                'allegationType' => Validate::enum($input['allegationType'] ?? null, self::ALLEGATION_TYPES, 'allegationType'),
                'neutralSummaryCiphertext' => EncryptedFields::seal(
                    Validate::string($input['neutralSummary'] ?? null, 'neutralSummary', 20, 8000),
                ),
                'immediateProtectionCiphertext' => EncryptedFields::seal(
                    Validate::string($input['immediateProtection'] ?? null, 'immediateProtection', 10, 8000),
                ),
                // Two days, because an allegation against a member of staff is
                // reviewed at once rather than in the ordinary queue.
                'reviewDueAt' => Dates::nowMillis() + 2 * self::DAY_MS,
                'createdBy' => $ctx->userId(),
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'action' => 'allegation.created',
                'resourceType' => 'allegation',
                'resourceId' => $id,
                'sensitivity' => 'restricted',
                'result' => 'success',
            ]);

            return ['id' => $id];
        });

        $registry->mutation('safeguarding.closeAllegation', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::assertReviewer($ctx, $input);
            $allegation = self::findOwned('allegations', $input['allegationId'] ?? null, 'allegationId', $entityId, 'Allegation not found');

            self::refuseSameHand(
                (int) $allegation->createdBy === $ctx->userId(),
                'A different manager must close the allegation',
            );

            $outcome = Validate::enum($input['outcome'] ?? null, self::ALLEGATION_OUTCOMES, 'outcome');
            $ladoDecision = Validate::enum($input['ladoDecision'] ?? null, self::LADO_DECISIONS, 'ladoDecision');
            $policeDecision = Validate::enum($input['policeDecision'] ?? null, self::POLICE_DECISIONS, 'policeDecision');
            $ofstedDecision = Validate::enum($input['ofstedDecision'] ?? null, self::OFSTED_DECISIONS, 'ofstedDecision');

            DB::table('allegations')->where('id', $allegation->id)->update([
                'outcome' => $outcome,
                'ladoDecision' => $ladoDecision,
                'policeDecision' => $policeDecision,
                'ofstedDecision' => $ofstedDecision,
                'outcomeCiphertext' => EncryptedFields::seal(
                    Validate::string($input['outcomeSummary'] ?? null, 'outcomeSummary', 20, 8000),
                ),
                'status' => 'closed',
                'closedAt' => Dates::nowMillis(),
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'propertyId' => $allegation->propertyId === null ? null : (int) $allegation->propertyId,
                'action' => 'allegation.closed',
                'resourceType' => 'allegation',
                'resourceId' => (int) $allegation->id,
                'sensitivity' => 'restricted',
                'result' => 'success',
                // The four external decisions are recorded together: an
                // inspector asks what LADO, the police and Ofsted each said.
                'metadata' => [
                    'outcome' => $outcome,
                    'ladoDecision' => $ladoDecision,
                    'policeDecision' => $policeDecision,
                    'ofstedDecision' => $ofstedDecision,
                ],
            ]);

            return ['success' => true];
        });

        $registry->mutation('safeguarding.createMissing', Registry::USER, static function (Context $ctx, mixed $input): array {
            [$entityId, $placement] = self::placementGuard($ctx, $input);

            $policeReference = Validate::optionalString($input['policeReference'] ?? null, 'policeReference', 120);
            $now = Dates::nowMillis();

            $id = (int) DB::table('missingEpisodes')->insertGetId([
                'entityId' => $entityId,
                'propertyId' => (int) $placement['propertyId'],
                'placementId' => (int) $placement['id'],
                'missingAt' => $now,
                'discoveredAt' => $now,
                // A police reference means the police have been called, so the
                // contact time is the moment the record was made.
                'policeContactedAt' => $policeReference === null ? null : $now,
                'policeReference' => $policeReference,
                'riskLevel' => Validate::enum($input['riskLevel'] ?? null, self::RISK_LEVELS, 'riskLevel'),
                'circumstancesCiphertext' => EncryptedFields::seal(
                    Validate::string($input['circumstances'] ?? null, 'circumstances', 20, 8000),
                ),
                'actionsCiphertext' => EncryptedFields::seal(Validate::string($input['actions'] ?? null, 'actions', 10, 8000)),
                // The statutory return interview window: 72 hours from going
                // missing, not from coming back.
                'returnInterviewDueAt' => $now + 72 * 3600000,
                'createdBy' => $ctx->userId(),
            ]);

            return ['id' => $id];
        });

        $registry->mutation('safeguarding.recordReturn', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $episode = self::findOwned('missingEpisodes', $input['episodeId'] ?? null, 'episodeId', $entityId, 'Missing episode not found');

            // Recording a return is a worker's job rather than a reviewer's, so
            // the check is the placement one.
            Authz::assertPlacementCapability($ctx->userId(), (int) $episode->placementId, 'incident.write');

            DB::table('missingEpisodes')->where('id', $episode->id)->update([
                'returnedAt' => Dates::nowMillis(),
                'returnMethod' => Validate::enum($input['returnMethod'] ?? null, self::RETURN_METHODS, 'returnMethod'),
                'returnCircumstancesCiphertext' => EncryptedFields::seal(
                    Validate::string($input['returnCircumstances'] ?? null, 'returnCircumstances', 10, 8000),
                ),
                'status' => 'interview_due',
                'returnRecordedBy' => $ctx->userId(),
            ]);

            return ['success' => true];
        });

        $registry->mutation('safeguarding.completeReturnInterview', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::assertReviewer($ctx, $input);
            $episode = self::findOwned('missingEpisodes', $input['episodeId'] ?? null, 'episodeId', $entityId, 'Missing episode not found');

            // The return interview is what a young person is asked about why
            // they went; the person who brought them back is not the person who
            // asks it.
            self::refuseSameHand(
                $episode->returnRecordedBy !== null && (int) $episode->returnRecordedBy === $ctx->userId(),
                'The return interview must be completed independently from the return record',
            );

            $followUpRequired = Validate::bool($input['followUpRequired'] ?? null, 'followUpRequired', true);

            DB::table('missingEpisodes')->where('id', $episode->id)->update([
                'returnInterviewAt' => Dates::nowMillis(),
                'returnInterviewOutcomeCiphertext' => EncryptedFields::seal(
                    Validate::string($input['outcome'] ?? null, 'outcome', 20, 8000),
                ),
                'learningCiphertext' => EncryptedFields::seal(Validate::string($input['learning'] ?? null, 'learning', 10, 8000)),
                'returnInterviewBy' => $ctx->userId(),
                'status' => $followUpRequired ? 'follow_up' : 'closed',
            ]);

            return ['success' => true];
        });

        $registry->mutation('safeguarding.createRestraint', Registry::USER, static function (Context $ctx, mixed $input): array {
            [$entityId, $placement] = self::placementGuard($ctx, $input);

            $durationMinutes = Validate::int($input['durationMinutes'] ?? null, 'durationMinutes', 1, 240);
            $now = Dates::nowMillis();

            $id = (int) DB::table('restraintEvents')->insertGetId([
                'entityId' => $entityId,
                'propertyId' => (int) $placement['propertyId'],
                'placementId' => (int) $placement['id'],
                'interventionType' => Validate::enum($input['interventionType'] ?? null, self::INTERVENTION_TYPES, 'interventionType'),
                // The form asks how long it lasted rather than when it began, so
                // the start is worked back from now.
                'startedAt' => $now - $durationMinutes * 60000,
                'endedAt' => $now,
                'necessityCiphertext' => EncryptedFields::seal(Validate::string($input['necessity'] ?? null, 'necessity', 20, 8000)),
                'proportionalityCiphertext' => EncryptedFields::seal(
                    Validate::string($input['proportionality'] ?? null, 'proportionality', 20, 8000),
                ),
                'medicalAttention' => Validate::enum($input['medicalAttention'] ?? 'none', self::MEDICAL_ATTENTION, 'medicalAttention'),
                'createdBy' => $ctx->userId(),
            ]);

            return ['id' => $id];
        });

        $registry->mutation('safeguarding.reviewRestraint', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::assertReviewer($ctx, $input);
            $restraint = self::findOwned('restraintEvents', $input['restraintId'] ?? null, 'restraintId', $entityId, 'Restraint record not found');

            self::refuseSameHand(
                (int) $restraint->createdBy === $ctx->userId(),
                'A different manager must review the restraint record',
            );

            DB::table('restraintEvents')->where('id', $restraint->id)->update([
                'managementReview' => Validate::enum($input['managementReview'] ?? null, self::MANAGEMENT_REVIEWS, 'managementReview'),
                'reviewNotesCiphertext' => EncryptedFields::seal(
                    Validate::string($input['reviewNotes'] ?? null, 'reviewNotes', 20, 8000),
                ),
                'reviewedBy' => $ctx->userId(),
                'reviewedAt' => Dates::nowMillis(),
                'status' => 'reviewed',
            ]);

            return ['success' => true];
        });

        $registry->mutation('safeguarding.createBehaviour', Registry::USER, static function (Context $ctx, mixed $input): array {
            [$entityId, $placement] = self::placementGuard($ctx, $input);

            $effectiveness = Validate::enum($input['effectiveness'] ?? null, self::EFFECTIVENESS, 'effectiveness');
            // Anything short of effective is a plan that is not working, which
            // puts a review in the diary rather than leaving it to be noticed.
            $reviewRequired = $effectiveness !== 'effective';
            $now = Dates::nowMillis();

            $id = (int) DB::table('behaviourSupportEvents')->insertGetId([
                'entityId' => $entityId,
                'propertyId' => (int) $placement['propertyId'],
                'placementId' => (int) $placement['id'],
                'occurredAt' => $now,
                'antecedentCiphertext' => EncryptedFields::seal(Validate::string($input['antecedent'] ?? null, 'antecedent', 10, 8000)),
                'behaviourCiphertext' => EncryptedFields::seal(Validate::string($input['behaviour'] ?? null, 'behaviour', 10, 8000)),
                'consequenceCiphertext' => EncryptedFields::seal(Validate::string($input['consequence'] ?? null, 'consequence', 10, 8000)),
                'positiveSupportCiphertext' => EncryptedFields::seal(
                    Validate::string($input['positiveSupport'] ?? null, 'positiveSupport', 10, 8000),
                ),
                'effectiveness' => $effectiveness,
                'youngPersonFeedbackCiphertext' => EncryptedFields::seal(
                    Validate::optionalString($input['youngPersonFeedback'] ?? null, 'youngPersonFeedback', 8000),
                ),
                'reviewRequired' => $reviewRequired ? 1 : 0,
                'reviewDueAt' => $reviewRequired ? $now + 7 * self::DAY_MS : null,
                'createdBy' => $ctx->userId(),
            ]);

            return ['id' => $id];
        });

        $registry->mutation('safeguarding.reviewBehaviour', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::assertReviewer($ctx, $input);
            $event = self::findOwned('behaviourSupportEvents', $input['eventId'] ?? null, 'eventId', $entityId, 'Behaviour-support event not found');

            self::refuseSameHand(
                (int) $event->createdBy === $ctx->userId(),
                'A different manager must review the behaviour-support event',
            );

            $reviewOutcome = Validate::enum($input['reviewOutcome'] ?? null, self::BEHAVIOUR_REVIEW_OUTCOMES, 'reviewOutcome');

            DB::table('behaviourSupportEvents')->where('id', $event->id)->update([
                'reviewRequired' => 0,
                'reviewedAt' => Dates::nowMillis(),
                'reviewedBy' => $ctx->userId(),
            ]);

            // The outcome is not a column on the event, so the audit trail is
            // the only place the reviewer's conclusion is kept.
            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'propertyId' => (int) $event->propertyId,
                'action' => 'behaviour_support.reviewed',
                'resourceType' => 'behaviour_support_event',
                'resourceId' => (int) $event->id,
                'sensitivity' => 'safeguarding',
                'result' => 'success',
                'metadata' => ['reviewOutcome' => $reviewOutcome],
            ]);

            return ['success' => true];
        });
    }

    private static function assertReviewer(Context $ctx, mixed $input): int
    {
        $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
        Authz::assertEntityCapability($ctx->userId(), $entityId, 'incident.review');

        return $entityId;
    }

    /**
     * The placement gate for the procedures that record an event as it happens.
     *
     * A placement with no property cannot be used here: every record written
     * through this router is scoped to a property, and one without would be
     * invisible to the workspace that is meant to show it.
     *
     * @return array{0: int, 1: array<string, mixed>}
     */
    private static function placementGuard(Context $ctx, mixed $input): array
    {
        $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
        $placementId = Validate::id($input['placementId'] ?? null, 'placementId');

        $result = Authz::assertPlacementCapability($ctx->userId(), $placementId, 'incident.write');
        $placement = $result['placement'];

        if ((int) $placement['entityId'] !== $entityId || $placement['propertyId'] === null) {
            throw TrpcException::forbidden('This young person is not placed at a property in the selected company.');
        }

        return [$entityId, $placement];
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

    /** The separation-of-duties refusal these records share. */
    private static function refuseSameHand(bool $sameHand, string $message): void
    {
        if ($sameHand) {
            throw TrpcException::forbidden($message);
        }
    }
}
