<?php

declare(strict_types=1);

namespace App\Trpc\Routers;

use App\Support\Audit;
use App\Support\Authz;
use App\Support\Dates;
use App\Support\EncryptedFields;
use App\Support\GovernanceRules;
use App\Trpc\Context;
use App\Trpc\Registry;
use App\Trpc\TrpcException;
use App\Trpc\Validate;
use Illuminate\Support\Facades\DB;

/**
 * governanceHub.*, mirroring server/routers/governanceHub.ts.
 *
 * Three things a regulator asks about: statutory data-rights requests, the
 * framework records that say which rules a company is working to, and the
 * outcome measures it reports against.
 *
 * Almost every step here needs a second person. A data-rights case is created,
 * its identity checked, then approved, and no one person may do two of those.
 */
final class GovernanceHubRouter
{
    private const REQUEST_TYPES = [
        'access', 'rectification', 'restriction', 'objection', 'erasure',
        'portability', 'sharing_review', 'complaint',
    ];

    private const REQUESTER_TYPES = [
        'young_person', 'parent', 'representative', 'professional', 'staff', 'other',
    ];

    private const SCOPE_AREAS = [
        'all_records', 'placement_records', 'safeguarding', 'workforce', 'finance', 'documents', 'other',
    ];

    private const REGIME_AREAS = ['properties', 'workforce', 'placements', 'records', 'finance', 'governance'];

    private const REASON_CODES = [
        'scope_confirmed', 'records_collected', 'redaction_complete', 'approval_requested',
        'restriction_applied', 'restriction_lifted', 'request_withdrawn', 'exemption_applied', 'case_closed',
    ];

    private const MEASURE_DOMAINS = [
        'incident', 'complaint', 'missing', 'restraint', 'placement', 'staffing',
        'compliance', 'finance', 'improvement', 'outcome', 'feedback',
    ];

    private const MEASURE_TYPES = ['count', 'percentage', 'average', 'duration', 'currency', 'score', 'custom'];

    private const IDENTITY_COMPLETE = ['verified', 'not_required'];

    public static function register(Registry $registry): void
    {
        $registry->query('governanceHub.workspace', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $access = Authz::assertEntityCapability($ctx->userId(), $entityId, 'data_rights.read');

            // Someone without whole-entity access sees only what belongs to the
            // properties they can reach; null here means no narrowing.
            $accessible = $access['role'] === 'owner' || $access['allProperties']
                ? null
                : Authz::accessiblePropertyIds($ctx->userId(), $entityId, 'property.read');

            $withinScope = static fn (?int $propertyId): bool => $accessible === null
                || ($propertyId !== null && in_array($propertyId, $accessible, true));

            $caseRows = DB::table('dataRightsCases as c')
                ->leftJoin('placements as p', 'p.id', '=', 'c.placementId')
                ->where('c.entityId', $entityId)
                ->orderByDesc('c.dueAt')->limit(100)
                ->select(['c.*', 'p.propertyId as placementPropertyId'])
                ->get();

            $cases = [];
            foreach ($caseRows as $row) {
                if (!$withinScope($row->placementPropertyId === null ? null : (int) $row->placementPropertyId)) {
                    continue;
                }
                $record = (array) $row;
                unset($record['placementPropertyId']);
                $cases[] = EncryptedFields::reveal($record, ['requesterName', 'requesterContact', 'identityReference']);
            }

            $observations = [];
            foreach (DB::table('outcomeObservations')->where('entityId', $entityId)
                ->orderByDesc('periodEnd')->limit(100)->get() as $row) {
                if (!$withinScope($row->propertyId === null ? null : (int) $row->propertyId)) {
                    continue;
                }
                $observation = EncryptedFields::reveal((array) $row, ['feedback']);
                // Context notes are working material for the analyst, not part of
                // the workspace view.
                unset($observation['contextNotes']);
                $observations[] = $observation;
            }

            $placementOptions = [];
            foreach (DB::table('placements')->where('entityId', $entityId)
                ->orderByDesc('updatedAt')->limit(100)
                ->select(['id', 'propertyId', 'status'])->get() as $row) {
                if ($withinScope($row->propertyId === null ? null : (int) $row->propertyId)) {
                    $placementOptions[] = (array) $row;
                }
            }

            $regimes = DB::table('regulatoryRegimes')->where('entityId', $entityId)
                ->orderByDesc('updatedAt')->limit(100)->get()->map(static fn ($r) => (array) $r)->all();
            $measures = DB::table('analyticsMeasures')->where('entityId', $entityId)
                ->orderByDesc('updatedAt')->limit(100)->get()->map(static fn ($r) => (array) $r)->all();

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'governance.workspace_read',
                'resourceType' => 'governance_workspace',
                'resourceId' => $entityId,
                'sensitivity' => 'restricted',
                'result' => 'allowed',
                'metadata' => [
                    'cases' => count($cases), 'regimes' => count($regimes),
                    'measures' => count($measures), 'observations' => count($observations),
                ],
            ]);

            return [
                'cases' => $cases,
                'regimes' => $regimes,
                'measures' => $measures,
                'observations' => $observations,
                'placementOptions' => $placementOptions,
            ];
        });

        $registry->mutation('governanceHub.createCase', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'data_rights.write');

            $receivedAt = Validate::int($input['receivedAt'] ?? null, 'receivedAt');
            $dueAt = Validate::int($input['dueAt'] ?? null, 'dueAt');

            // The statutory clock runs from receipt, so a due date on or before
            // it would be wrong on the face of the record.
            if ($dueAt <= $receivedAt) {
                throw TrpcException::badRequest('The response due date must be after the received date');
            }

            $caseReference = Validate::string($input['caseReference'] ?? null, 'caseReference', 4, 64);
            if (preg_match('/^[A-Z0-9-]{4,64}$/', $caseReference) !== 1) {
                throw TrpcException::badRequest('Case reference may use capital letters, numbers and hyphens only.');
            }

            $placementId = Validate::optionalId($input['placementId'] ?? null, 'placementId');
            if ($placementId !== null) {
                Authz::assertPlacementCapability($ctx->userId(), $placementId, 'young_person.read');
            }

            $scope = Validate::arrayOf($input['scope'] ?? null, 'scope', 7);
            if ($scope === []) {
                throw TrpcException::badRequest('Name at least one area the request covers.');
            }
            foreach ($scope as $index => $area) {
                Validate::enum($area, self::SCOPE_AREAS, "scope.$index");
            }

            $requestType = Validate::enum($input['requestType'] ?? null, self::REQUEST_TYPES, 'requestType');

            $caseId = DB::transaction(static function () use ($ctx, $entityId, $placementId, $caseReference, $requestType, $scope, $receivedAt, $dueAt, $input): int {
                $id = (int) DB::table('dataRightsCases')->insertGetId([
                    'entityId' => $entityId,
                    'placementId' => $placementId,
                    'caseReference' => $caseReference,
                    'requestType' => $requestType,
                    'requesterType' => Validate::enum($input['requesterType'] ?? null, self::REQUESTER_TYPES, 'requesterType'),
                    // The requester may be a young person or a member of the
                    // public, so their name and contact details are encrypted.
                    'requesterNameCiphertext' => EncryptedFields::seal(Validate::string($input['requesterName'] ?? null, 'requesterName', 2, 180)),
                    'requesterContactCiphertext' => EncryptedFields::seal(Validate::optionalString($input['requesterContact'] ?? null, 'requesterContact', 320)),
                    'scope' => json_encode(['areas' => $scope], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                    'receivedAt' => $receivedAt,
                    'dueAt' => $dueAt,
                    // A case opens at identity_check: nothing is disclosed before
                    // the requester is shown to be who they say they are.
                    'status' => 'identity_check',
                    'identityStatus' => 'pending',
                    'ownerUserId' => $ctx->userId(),
                    'createdBy' => $ctx->userId(),
                ]);

                self::recordEvent($ctx, $entityId, $id, 'case.created', [
                    'requestType' => $requestType,
                    'placementLinked' => $placementId !== null,
                    'dueAt' => $dueAt,
                ]);

                return $id;
            });

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => $entityId,
                'action' => 'data_rights.case_create', 'resourceType' => 'data_rights_case',
                'resourceId' => $caseId, 'sensitivity' => 'restricted', 'result' => 'success',
                'metadata' => ['requestType' => $requestType, 'dueAt' => $dueAt],
            ]);

            return ['id' => $caseId];
        });

        $registry->mutation('governanceHub.verifyCaseIdentity', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $caseId = Validate::id($input['caseId'] ?? null, 'caseId');
            $record = self::loadCaseWithScope($ctx, $entityId, $caseId, 'data_rights.write');

            // Whoever opened the case cannot also be the one who confirms the
            // requester is genuine.
            if ((int) $record->createdBy === $ctx->userId()) {
                throw TrpcException::forbidden('A different authorised user must verify case identity');
            }

            if (!in_array($record->identityStatus, ['not_started', 'pending'], true)) {
                throw new TrpcException('PRECONDITION_FAILED', 'Identity has already been decided');
            }

            $status = Validate::enum($input['status'] ?? null, ['verified', 'failed', 'not_required'], 'status');
            $method = Validate::string($input['method'] ?? null, 'method', 3, 160);
            $reference = Validate::optionalString($input['reference'] ?? null, 'reference', 500);

            $nextStatus = in_array($status, self::IDENTITY_COMPLETE, true) ? 'scoping' : 'refused';

            DB::transaction(static function () use ($ctx, $entityId, $record, $status, $method, $reference, $nextStatus): void {
                DB::table('dataRightsCases')->where('id', $record->id)->update([
                    'identityStatus' => $status,
                    'identityMethod' => $method,
                    // The reference can be a passport or licence number.
                    'identityReferenceCiphertext' => EncryptedFields::seal($reference),
                    'identityVerifiedBy' => $ctx->userId(),
                    'identityVerifiedAt' => Dates::nowMillis(),
                    'status' => $nextStatus,
                ]);

                self::recordEvent($ctx, $entityId, (int) $record->id, 'identity.decided', [
                    'status' => $status, 'method' => $method,
                ]);
            });

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => $entityId,
                'action' => 'data_rights.identity_decide', 'resourceType' => 'data_rights_case',
                'resourceId' => (int) $record->id, 'sensitivity' => 'restricted', 'result' => 'success',
                'metadata' => ['status' => $status],
            ]);

            return ['success' => true];
        });

        $registry->mutation('governanceHub.transitionCase', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $caseId = Validate::id($input['caseId'] ?? null, 'caseId');
            $record = self::loadCaseWithScope($ctx, $entityId, $caseId, 'data_rights.write');

            $status = Validate::enum($input['status'] ?? null, self::caseStatuses(), 'status');
            $reasonCode = Validate::enum($input['reasonCode'] ?? null, self::REASON_CODES, 'reasonCode');

            if (!GovernanceRules::dataRightsTransitionAllowed((string) $record->status, $status)) {
                throw new TrpcException('PRECONDITION_FAILED', 'This case cannot move to the requested state');
            }

            // Nothing reaches approval before identity is settled, whatever
            // route the case took to get there.
            if ($status === 'awaiting_approval' && !in_array($record->identityStatus, self::IDENTITY_COMPLETE, true)) {
                throw new TrpcException('PRECONDITION_FAILED', 'Identity verification is required before approval');
            }

            DB::transaction(static function () use ($ctx, $entityId, $record, $status, $reasonCode): void {
                DB::table('dataRightsCases')->where('id', $record->id)->update(['status' => $status]);

                self::recordEvent($ctx, $entityId, (int) $record->id, 'case.status_changed', [
                    'from' => $record->status, 'to' => $status, 'reasonCode' => $reasonCode,
                ]);
            });

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => $entityId,
                'action' => 'data_rights.status_change', 'resourceType' => 'data_rights_case',
                'resourceId' => (int) $record->id, 'sensitivity' => 'restricted', 'result' => 'success',
                'metadata' => ['from' => $record->status, 'to' => $status, 'reasonCode' => $reasonCode],
            ]);

            return ['success' => true];
        });

        $registry->mutation('governanceHub.approveCase', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $caseId = Validate::id($input['caseId'] ?? null, 'caseId');
            $record = self::loadCaseWithScope($ctx, $entityId, $caseId, 'data_rights.write');

            if ($record->status !== 'awaiting_approval') {
                throw new TrpcException('PRECONDITION_FAILED', 'Only a prepared case can be approved');
            }
            if (!in_array($record->identityStatus, self::IDENTITY_COMPLETE, true)) {
                throw new TrpcException('PRECONDITION_FAILED', 'Identity verification is incomplete');
            }

            // Three roles, three people: whoever opened the case and whoever
            // verified identity are both barred from approving the disclosure.
            if (!GovernanceRules::independentlyApprovedBy($ctx->userId(), [
                $record->createdBy === null ? null : (int) $record->createdBy,
                $record->identityVerifiedBy === null ? null : (int) $record->identityVerifiedBy,
            ])) {
                throw TrpcException::forbidden('A different authorised user must approve the case');
            }

            DB::transaction(static function () use ($ctx, $entityId, $record): void {
                DB::table('dataRightsCases')->where('id', $record->id)->update([
                    'status' => 'ready',
                    'approvedBy' => $ctx->userId(),
                    'approvedAt' => Dates::nowMillis(),
                ]);

                self::recordEvent($ctx, $entityId, (int) $record->id, 'case.approved', []);
            });

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => $entityId,
                'action' => 'data_rights.case_approve', 'resourceType' => 'data_rights_case',
                'resourceId' => (int) $record->id, 'sensitivity' => 'restricted', 'result' => 'success',
            ]);

            return ['success' => true];
        });

        $registry->mutation('governanceHub.recordCaseDelivery', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $caseId = Validate::id($input['caseId'] ?? null, 'caseId');
            $record = self::loadCaseWithScope($ctx, $entityId, $caseId, 'data_rights.write');

            if ($record->status !== 'ready') {
                throw new TrpcException('PRECONDITION_FAILED', 'Only approved, ready cases can be delivered');
            }

            $method = Validate::enum($input['method'] ?? null, ['secure_link', 'secure_email', 'post', 'collection', 'other'], 'method');
            $reference = Validate::string($input['reference'] ?? null, 'reference', 3, 180);

            DB::transaction(static function () use ($ctx, $entityId, $record, $method, $reference): void {
                DB::table('dataRightsCases')->where('id', $record->id)->update([
                    'status' => 'delivered',
                    'deliveredAt' => Dates::nowMillis(),
                ]);

                self::recordEvent($ctx, $entityId, (int) $record->id, 'case.delivered', [
                    'method' => $method, 'reference' => $reference,
                ]);
            });

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => $entityId,
                'action' => 'data_rights.case_delivery', 'resourceType' => 'data_rights_case',
                'resourceId' => (int) $record->id, 'sensitivity' => 'restricted', 'result' => 'success',
                'metadata' => ['method' => $method],
            ]);

            return ['success' => true];
        });

        $registry->mutation('governanceHub.createRegime', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'config.write');

            $effectiveFrom = Validate::int($input['effectiveFrom'] ?? null, 'effectiveFrom');
            $effectiveTo = isset($input['effectiveTo']) ? Validate::int($input['effectiveTo'], 'effectiveTo') : null;

            if ($effectiveTo !== null && $effectiveTo <= $effectiveFrom) {
                throw TrpcException::badRequest('The end date must be after the effective date');
            }

            $sourceUrl = Validate::string($input['sourceUrl'] ?? null, 'sourceUrl', 1, 1000);
            if (filter_var($sourceUrl, FILTER_VALIDATE_URL) === false) {
                throw TrpcException::badRequest('Enter the web address the framework is published at.');
            }

            $applicability = Validate::arrayOf($input['applicability'] ?? null, 'applicability', 6);
            if ($applicability === []) {
                throw TrpcException::badRequest('Name at least one area the framework applies to.');
            }
            foreach ($applicability as $index => $area) {
                Validate::enum($area, self::REGIME_AREAS, "applicability.$index");
            }

            $jurisdiction = Validate::string($input['jurisdiction'] ?? null, 'jurisdiction', 2, 120);

            $regimeId = (int) DB::table('regulatoryRegimes')->insertGetId([
                'entityId' => $entityId,
                'name' => Validate::string($input['name'] ?? null, 'name', 3, 220),
                'jurisdiction' => $jurisdiction,
                'regulator' => Validate::optionalString($input['regulator'] ?? null, 'regulator', 180),
                // The published source is recorded so a claim about the rules can
                // be traced back to them.
                'sourceUrl' => $sourceUrl,
                'effectiveFrom' => $effectiveFrom,
                'effectiveTo' => $effectiveTo,
                'applicability' => json_encode(['areas' => $applicability], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                'status' => 'draft',
                'createdBy' => $ctx->userId(),
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => $entityId,
                'action' => 'regulatory_regime.create', 'resourceType' => 'regulatory_regime',
                'resourceId' => $regimeId, 'sensitivity' => 'restricted', 'result' => 'success',
                'metadata' => ['jurisdiction' => $jurisdiction],
            ]);

            return ['id' => $regimeId];
        });

        $registry->mutation('governanceHub.submitRegimeForReview', Registry::USER, static function (Context $ctx, mixed $input): array {
            [$entityId, $record] = self::regimeFor($ctx, $input);

            if (!GovernanceRules::regimeTransitionAllowed((string) $record->status, 'in_review')) {
                throw new TrpcException('PRECONDITION_FAILED', 'This framework record cannot be submitted for review');
            }

            DB::table('regulatoryRegimes')->where('id', $record->id)->update(['status' => 'in_review']);

            self::auditRegime($ctx, $entityId, 'submit', (int) $record->id);

            return ['success' => true];
        });

        $registry->mutation('governanceHub.approveRegime', Registry::USER, static function (Context $ctx, mixed $input): array {
            [$entityId, $record] = self::regimeFor($ctx, $input);

            if (!GovernanceRules::regimeTransitionAllowed((string) $record->status, 'approved')) {
                throw new TrpcException('PRECONDITION_FAILED', 'This framework record is not ready for approval');
            }
            if (!GovernanceRules::independentlyApprovedBy($ctx->userId(), [$record->createdBy === null ? null : (int) $record->createdBy])) {
                throw TrpcException::forbidden('A different authorised user must approve this framework record');
            }

            DB::table('regulatoryRegimes')->where('id', $record->id)->update([
                'status' => 'approved',
                'approvedBy' => $ctx->userId(),
                'approvedAt' => Dates::nowMillis(),
            ]);

            self::auditRegime($ctx, $entityId, 'approve', (int) $record->id);

            return ['success' => true];
        });

        $registry->mutation('governanceHub.activateRegime', Registry::USER, static function (Context $ctx, mixed $input): array {
            [$entityId, $record] = self::regimeFor($ctx, $input);

            if (!GovernanceRules::regimeTransitionAllowed((string) $record->status, 'active')) {
                throw new TrpcException('PRECONDITION_FAILED', 'This framework record is not approved for activation');
            }

            // A third person again: neither the author nor the approver puts it
            // into force.
            if (!GovernanceRules::independentlyApprovedBy($ctx->userId(), [
                $record->createdBy === null ? null : (int) $record->createdBy,
                $record->approvedBy === null ? null : (int) $record->approvedBy,
            ])) {
                throw TrpcException::forbidden('A different authorised user must activate this approved framework record');
            }

            DB::transaction(static function () use ($ctx, $entityId, $record): void {
                // Only one framework of a given name and jurisdiction is in force
                // at a time, so the previous one is superseded in the same
                // transaction rather than left alongside it.
                DB::table('regulatoryRegimes')
                    ->where('entityId', $entityId)
                    ->where('name', $record->name)
                    ->where('jurisdiction', $record->jurisdiction)
                    ->where('status', 'active')
                    ->update(['status' => 'superseded']);

                DB::table('regulatoryRegimes')->where('id', $record->id)->update([
                    'status' => 'active',
                    'activatedBy' => $ctx->userId(),
                    'activatedAt' => Dates::nowMillis(),
                ]);
            });

            self::auditRegime($ctx, $entityId, 'activate', (int) $record->id, ['supersedesExisting' => true]);

            return ['success' => true];
        });

        $registry->mutation('governanceHub.createMeasure', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'analytics.write');

            $key = Validate::string($input['key'] ?? null, 'key', 2, 100);
            if (preg_match('/^[a-z0-9][a-z0-9_-]{1,98}$/', $key) !== 1) {
                throw TrpcException::badRequest('Measure key may use lower-case letters, numbers, hyphens and underscores.');
            }

            $domain = Validate::enum($input['domain'] ?? null, self::MEASURE_DOMAINS, 'domain');

            $measureId = (int) DB::table('analyticsMeasures')->insertGetId([
                'entityId' => $entityId,
                'key' => $key,
                'name' => Validate::string($input['name'] ?? null, 'name', 3, 220),
                'domain' => $domain,
                'measureType' => Validate::enum($input['measureType'] ?? null, self::MEASURE_TYPES, 'measureType'),
                'unit' => Validate::optionalString($input['unit'] ?? null, 'unit', 60),
                'direction' => Validate::enum($input['direction'] ?? 'neutral', ['higher_is_better', 'lower_is_better', 'neutral'], 'direction'),
                'sourceType' => Validate::enum($input['sourceType'] ?? 'manual_observation', ['system', 'manual_observation', 'young_person_feedback'], 'sourceType'),
                // What counts and what does not is recorded with the measure, so
                // a number can be read the same way a year later.
                'numeratorDefinition' => Validate::optionalString($input['numeratorDefinition'] ?? null, 'numeratorDefinition', 2000),
                'denominatorDefinition' => Validate::optionalString($input['denominatorDefinition'] ?? null, 'denominatorDefinition', 2000),
                'exclusionNotes' => Validate::optionalString($input['exclusionNotes'] ?? null, 'exclusionNotes', 2000),
                'status' => 'draft',
                'createdBy' => $ctx->userId(),
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => $entityId,
                'action' => 'outcome_measure.create', 'resourceType' => 'analytics_measure',
                'resourceId' => $measureId, 'sensitivity' => 'restricted', 'result' => 'success',
                'metadata' => ['key' => $key, 'domain' => $domain],
            ]);

            return ['id' => $measureId];
        });

        $registry->mutation('governanceHub.activateMeasure', Registry::USER, static function (Context $ctx, mixed $input): array {
            [$entityId, $record] = self::measureFor($ctx, $input);

            if (!in_array($record->status, ['draft', 'paused'], true)) {
                throw new TrpcException('PRECONDITION_FAILED', 'Only draft or paused measures can be activated');
            }

            // A measure decides what the company reports about itself, so it is
            // not put into use by the person who defined it.
            if (!GovernanceRules::independentlyApprovedBy($ctx->userId(), [$record->createdBy === null ? null : (int) $record->createdBy])) {
                throw TrpcException::forbidden('A different authorised user must activate this measure');
            }

            DB::table('analyticsMeasures')->where('id', $record->id)->update([
                'status' => 'active',
                'approvedBy' => $ctx->userId(),
                'approvedAt' => Dates::nowMillis(),
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => $entityId,
                'action' => 'outcome_measure.activate', 'resourceType' => 'analytics_measure',
                'resourceId' => (int) $record->id, 'sensitivity' => 'restricted', 'result' => 'success',
            ]);

            return ['success' => true];
        });

        $registry->mutation('governanceHub.pauseMeasure', Registry::USER, static function (Context $ctx, mixed $input): array {
            [$entityId, $record] = self::measureFor($ctx, $input);

            if ($record->status !== 'active') {
                throw new TrpcException('PRECONDITION_FAILED', 'Only active measures can be paused');
            }

            DB::table('analyticsMeasures')->where('id', $record->id)->update(['status' => 'paused']);

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => $entityId,
                'action' => 'outcome_measure.pause', 'resourceType' => 'analytics_measure',
                'resourceId' => (int) $record->id, 'sensitivity' => 'restricted', 'result' => 'success',
            ]);

            return ['success' => true];
        });

        $registry->mutation('governanceHub.recordObservation', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'analytics.write');

            $measureId = Validate::id($input['measureId'] ?? null, 'measureId');
            $measure = DB::table('analyticsMeasures')->where('id', $measureId)->where('entityId', $entityId)->first();
            if ($measure === null) {
                throw TrpcException::notFound('Outcome measure not found');
            }
            if ($measure->status !== 'active') {
                throw new TrpcException('PRECONDITION_FAILED', 'Only active measures can receive observations');
            }

            $periodStart = Validate::int($input['periodStart'] ?? null, 'periodStart');
            $periodEnd = Validate::int($input['periodEnd'] ?? null, 'periodEnd');
            if (!GovernanceRules::validObservationPeriod($periodStart, $periodEnd)) {
                throw TrpcException::badRequest('Observation period end must be after its start');
            }

            $numericValue = Validate::optionalString($input['numericValue'] ?? null, 'numericValue', 20);
            if ($numericValue !== null && preg_match('/^-?\d{1,9}(\.\d{1,3})?$/', $numericValue) !== 1) {
                throw TrpcException::badRequest('Enter the value as a number with up to three decimal places.');
            }
            $feedbackScore = isset($input['feedbackScore']) ? Validate::int($input['feedbackScore'], 'feedbackScore', 0, 10) : null;
            $feedback = Validate::optionalString($input['feedback'] ?? null, 'feedback', 4000);

            // An observation with nothing in it would count towards a measure
            // while saying nothing.
            if ($numericValue === null && $feedbackScore === null && $feedback === null) {
                throw TrpcException::badRequest('Record a numeric value, score, or feedback');
            }

            $placementId = Validate::id($input['placementId'] ?? null, 'placementId');
            $placement = Authz::assertPlacementCapability($ctx->userId(), $placementId, 'young_person.write')['placement'];

            if ((int) $placement['entityId'] !== $entityId) {
                throw TrpcException::forbidden('Placement is outside the selected entity');
            }

            $propertyId = $placement['propertyId'] === null ? null : (int) $placement['propertyId'];
            $source = Validate::enum($input['source'] ?? null, ['young_person', 'key_worker', 'manager', 'professional', 'system_import'], 'source');

            $observationId = (int) DB::table('outcomeObservations')->insertGetId([
                'entityId' => $entityId,
                'measureId' => $measureId,
                'placementId' => $placementId,
                'propertyId' => $propertyId,
                'periodStart' => $periodStart,
                'periodEnd' => $periodEnd,
                'numericValue' => $numericValue,
                'feedbackScore' => $feedbackScore,
                // A young person's own words about their experience.
                'feedbackCiphertext' => EncryptedFields::seal($feedback),
                'source' => $source,
                'capturedBy' => $ctx->userId(),
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => $entityId, 'propertyId' => $propertyId,
                'action' => 'outcome_observation.record', 'resourceType' => 'outcome_observation',
                'resourceId' => $observationId, 'sensitivity' => 'restricted', 'result' => 'success',
                'metadata' => ['measureId' => $measureId, 'placementId' => $placementId, 'source' => $source],
            ]);

            return ['id' => $observationId];
        });
    }

    /** @return array<int, string> */
    private static function caseStatuses(): array
    {
        return [
            'received', 'identity_check', 'scoping', 'collecting', 'redacting', 'awaiting_approval',
            'ready', 'delivered', 'restricted', 'refused', 'withdrawn', 'closed', 'overdue',
        ];
    }

    /**
     * Loads a case and confirms the caller may reach it.
     *
     * A case tied to a placement follows that placement's property scope. A case
     * with no placement covers the company as a whole, so it needs whole-entity
     * access rather than access to any one property.
     */
    private static function loadCaseWithScope(Context $ctx, int $entityId, int $caseId, string $capability): object
    {
        $access = Authz::assertEntityCapability($ctx->userId(), $entityId, $capability);

        $record = DB::table('dataRightsCases')->where('id', $caseId)->where('entityId', $entityId)->first();
        if ($record === null) {
            throw TrpcException::notFound('Data-rights case not found');
        }

        $wholeEntity = $access['role'] === 'owner' || $access['allProperties'];

        if ($record->placementId === null) {
            if (!$wholeEntity) {
                throw TrpcException::forbidden('Entity-wide data-rights cases require whole-entity access');
            }

            return $record;
        }

        $placement = DB::table('placements')->where('id', $record->placementId)->first(['propertyId', 'entityId']);
        if ($placement === null || (int) $placement->entityId !== $entityId) {
            throw TrpcException::notFound('Linked placement not found');
        }

        if ($placement->propertyId !== null) {
            Authz::assertPropertyCapability($ctx->userId(), $entityId, (int) $placement->propertyId, 'property.read');
        } elseif (!$wholeEntity) {
            throw TrpcException::forbidden('Placement scope is not available');
        }

        return $record;
    }

    /** @return array{0: int, 1: object} */
    private static function regimeFor(Context $ctx, mixed $input): array
    {
        $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
        Authz::assertEntityCapability($ctx->userId(), $entityId, 'config.write');

        $record = DB::table('regulatoryRegimes')
            ->where('id', Validate::id($input['regimeId'] ?? null, 'regimeId'))
            ->where('entityId', $entityId)->first();

        if ($record === null) {
            throw TrpcException::notFound('Regulatory framework record not found');
        }

        return [$entityId, $record];
    }

    /** @return array{0: int, 1: object} */
    private static function measureFor(Context $ctx, mixed $input): array
    {
        $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
        Authz::assertEntityCapability($ctx->userId(), $entityId, 'analytics.write');

        $record = DB::table('analyticsMeasures')
            ->where('id', Validate::id($input['measureId'] ?? null, 'measureId'))
            ->where('entityId', $entityId)->first();

        if ($record === null) {
            throw TrpcException::notFound('Outcome measure not found');
        }

        return [$entityId, $record];
    }

    /**
     * A case carries its own event log beside the audit trail: the audit trail
     * answers who did what, and this answers what happened to the case, which is
     * what a statutory response has to show.
     *
     * @param array<string, mixed> $metadata
     */
    private static function recordEvent(Context $ctx, int $entityId, int $caseId, string $eventType, array $metadata): void
    {
        DB::table('dataRightsEvents')->insert([
            'entityId' => $entityId,
            'caseId' => $caseId,
            'eventType' => $eventType,
            'occurredAt' => Dates::nowMillis(),
            'actorUserId' => $ctx->userId(),
            'metadata' => json_encode($metadata, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
        ]);
    }

    /** @param array<string, mixed> $metadata */
    private static function auditRegime(Context $ctx, int $entityId, string $action, int $regimeId, array $metadata = []): void
    {
        Audit::write([
            'actorUserId' => $ctx->userId(),
            'entityId' => $entityId,
            'action' => "regulatory_regime.$action",
            'resourceType' => 'regulatory_regime',
            'resourceId' => $regimeId,
            'sensitivity' => 'restricted',
            'result' => 'success',
        ] + ($metadata === [] ? [] : ['metadata' => $metadata]));
    }
}
