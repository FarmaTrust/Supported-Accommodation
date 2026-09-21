<?php

declare(strict_types=1);

namespace App\Trpc\Routers;

use App\Support\Audit;
use App\Support\Authz;
use App\Support\Crypto;
use App\Support\Dates;
use App\Support\Rules;
use App\Trpc\Context;
use App\Trpc\Registry;
use App\Trpc\TrpcException;
use App\Trpc\Validate;
use Illuminate\Support\Facades\DB;

/**
 * entities.*, mirroring server/routers/entities.ts.
 *
 * Companies, their properties, the rooms inside them and the property-compliance
 * evidence that keeps a property lettable. The workspace loads these first, so
 * this is the router the rest of the app leans on.
 */
final class EntitiesRouter
{
    private const ACCOMMODATION_TYPES = [
        'single_occupancy', 'ring_fenced_shared', 'non_ring_fenced_shared', 'supported_lodgings', 'other',
    ];

    private const EVIDENCE_RECORD_TYPES = [
        'certificate', 'insurance', 'lease', 'licence', 'contractor', 'maintenance', 'inventory',
        'location_assessment', 'fire_risk', 'gas_safety', 'electrical_safety', 'water_safety', 'other',
    ];

    private const UNIT_TYPES = ['bedroom', 'self_contained', 'lodgings_room', 'other'];

    private const OCCUPANCY_EVENTS = [
        'reserved', 'move_in', 'move_out', 'made_available', 'maintenance_start', 'maintenance_end',
    ];

    /** The unit status each occupancy event leaves behind. */
    private const OCCUPANCY_STATUS = [
        'reserved' => 'reserved',
        'move_in' => 'occupied',
        'move_out' => 'available',
        'made_available' => 'available',
        'maintenance_start' => 'maintenance',
        'maintenance_end' => 'available',
    ];

    public static function register(Registry $registry): void
    {
        $registry->query('entities.list', Registry::USER, static function (Context $ctx): array {
            $access = Authz::userAccess($ctx->userId());

            if ($access['user']['operationalRole'] === 'owner') {
                return DB::table('entities')->get()->map(static fn ($row) => (array) $row)->all();
            }

            $ids = array_column($access['memberships'], 'entityId');
            if ($ids === []) {
                return [];
            }

            return DB::table('entities')->whereIn('id', $ids)->get()
                ->map(static fn ($row) => (array) $row)->all();
        });

        $registry->mutation('entities.create', Registry::USER, static function (Context $ctx, mixed $input): array {
            $user = $ctx->requireUser();
            Authz::ensureOwner((string) $user['operationalRole']);

            $name = Validate::string($input['name'] ?? null, 'name', 2, 160);
            $legalName = Validate::string($input['legalName'] ?? null, 'legalName', 2, 220);
            $companyNumber = Validate::optionalString($input['companyNumber'] ?? null, 'companyNumber', 32);
            $ofstedUrn = Validate::optionalString($input['ofstedUrn'] ?? null, 'ofstedUrn', 64);
            $email = ($input['email'] ?? '') === '' ? null : Validate::email($input['email']);
            $invoicePrefix = Validate::string($input['invoicePrefix'] ?? null, 'invoicePrefix', 2, 12);
            if (preg_match('/^[A-Z0-9-]+$/', $invoicePrefix) !== 1) {
                throw TrpcException::badRequest('Invoice prefix may use capital letters, numbers and hyphens only.');
            }
            $vatRate = Validate::decimal($input['defaultVatRate'] ?? 0, 'defaultVatRate', 0, 100);

            // A duplicate company splits its properties, placements and invoices
            // across two records that no report puts back together, so the
            // existing one is named rather than silently creating another.
            $duplicate = DB::table('entities')
                ->where(function ($query) use ($legalName, $companyNumber): void {
                    $query->whereRaw('LOWER(TRIM(legalName)) = ?', [strtolower(trim($legalName))]);
                    if ($companyNumber !== null) {
                        $query->orWhereRaw(
                            "UPPER(REPLACE(companyNumber, ' ', '')) = ?",
                            [strtoupper((string) preg_replace('/\s+/', '', $companyNumber))]
                        );
                    }
                })
                ->first('id');

            if ($duplicate !== null) {
                throw TrpcException::conflict(
                    "A legal entity with the same name or company number already exists (#{$duplicate->id}). Review it instead of creating a duplicate."
                );
            }

            $entityId = DB::transaction(static function () use ($ctx, $name, $legalName, $companyNumber, $ofstedUrn, $email, $invoicePrefix, $vatRate): int {
                $id = (int) DB::table('entities')->insertGetId([
                    'name' => $name,
                    'legalName' => $legalName,
                    'companyNumber' => $companyNumber,
                    'ofstedUrn' => $ofstedUrn,
                    'email' => $email,
                    'invoicePrefix' => $invoicePrefix,
                    'defaultVatRate' => number_format($vatRate, 2, '.', ''),
                    'createdBy' => $ctx->userId(),
                    'status' => 'active',
                ]);

                // The creator becomes the owner in the same transaction, so a
                // company can never exist with nobody able to administer it.
                DB::table('entityMemberships')->upsert([[
                    'entityId' => $id,
                    'userId' => $ctx->userId(),
                    'operationalRole' => 'owner',
                    'allProperties' => 1,
                    'status' => 'active',
                    'createdBy' => $ctx->userId(),
                ]], ['entityId', 'userId'], ['status', 'operationalRole', 'allProperties']);

                return $id;
            });

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'entity.create',
                'resourceType' => 'entity',
                'resourceId' => $entityId,
                'result' => 'success',
            ]);

            return ['id' => $entityId];
        });

        $registry->mutation('entities.updateBankDetails', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'finance.write');

            $accountName = Validate::string($input['accountName'] ?? null, 'accountName', 2, 180);
            $sortCode = Validate::string($input['sortCode'] ?? null, 'sortCode', 6, 8);
            $accountNumber = Validate::string($input['accountNumber'] ?? null, 'accountNumber', 8, 8);

            if (preg_match('/^\d{2}-?\d{2}-?\d{2}$/', $sortCode) !== 1) {
                throw TrpcException::badRequest('Enter a sort code as six digits, for example 12-34-56.');
            }
            if (preg_match('/^\d{8}$/', $accountNumber) !== 1) {
                throw TrpcException::badRequest('Enter an account number as eight digits.');
            }

            DB::table('entities')->where('id', $entityId)->update([
                'bankAccountName' => $accountName,
                // Stored encrypted: these are the details invoices are paid into.
                'bankSortCodeCiphertext' => Crypto::encrypt(str_replace('-', '', $sortCode)),
                'bankAccountNumberCiphertext' => Crypto::encrypt($accountNumber),
                'bankDetailsUpdatedAt' => Dates::nowMillis(),
                'bankDetailsUpdatedBy' => $ctx->userId(),
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'entity.bank_details.update',
                'resourceType' => 'entity',
                'resourceId' => $entityId,
                'sensitivity' => 'bank',
                'result' => 'success',
            ]);

            return ['success' => true];
        });

        $registry->query('entities.members', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'compliance.write');

            return DB::table('entityMemberships as m')
                ->join('users as u', 'u.id', '=', 'm.userId')
                ->where('m.entityId', $entityId)
                ->where('m.status', 'active')
                ->select(['u.id as userId', 'u.name', 'u.email', 'm.operationalRole as role'])
                ->get()->map(static fn ($row) => (array) $row)->all();
        });

        $registry->query('entities.properties', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyIds = Authz::currentShiftPropertyIds($ctx->userId(), $entityId, 'property.read');

            if ($propertyIds === []) {
                return [];
            }

            return DB::table('properties')
                ->where('entityId', $entityId)
                ->whereIn('id', $propertyIds)
                ->get()->map(static fn ($row) => (array) $row)->all();
        });

        $registry->mutation('entities.createProperty', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'property.write');

            $name = Validate::string($input['name'] ?? null, 'name', 2, 160);
            $addressLine1 = Validate::string($input['addressLine1'] ?? null, 'addressLine1', 3, 180);
            $city = Validate::string($input['city'] ?? null, 'city', 2, 120);
            $postcode = Validate::string($input['postcode'] ?? null, 'postcode', 5, 16);
            $accommodationType = Validate::enum($input['accommodationType'] ?? null, self::ACCOMMODATION_TYPES, 'accommodationType');
            $capacity = Validate::int($input['capacity'] ?? null, 'capacity', 1, 100);
            $minimumStaffing = Validate::int($input['minimumStaffing'] ?? 1, 'minimumStaffing', 1, 20);
            $ofstedSettingReference = Validate::optionalString($input['ofstedSettingReference'] ?? null, 'ofstedSettingReference', 80);

            // The same address entered twice splits a property's compliance
            // history, so the existing record is named instead.
            $existing = DB::table('properties')->where('entityId', $entityId)
                ->select(['id', 'addressLine1', 'postcode'])->get();

            foreach ($existing as $row) {
                if (Rules::normaliseForComparison($row->addressLine1) === Rules::normaliseForComparison($addressLine1)
                    && Rules::normaliseForComparison($row->postcode) === Rules::normaliseForComparison($postcode)) {
                    throw TrpcException::conflict(
                        "This address already exists as property #{$row->id}. Open that record rather than creating another."
                    );
                }
            }

            $propertyId = DB::transaction(static function () use ($ctx, $entityId, $name, $addressLine1, $city, $postcode, $accommodationType, $capacity, $minimumStaffing, $ofstedSettingReference): int {
                $id = (int) DB::table('properties')->insertGetId([
                    'entityId' => $entityId,
                    'name' => $name,
                    'addressLine1' => $addressLine1,
                    'city' => $city,
                    'postcode' => $postcode,
                    'accommodationType' => $accommodationType,
                    'capacity' => $capacity,
                    'minimumStaffing' => $minimumStaffing,
                    'ofstedSettingReference' => $ofstedSettingReference,
                    'createdBy' => $ctx->userId(),
                    'status' => 'onboarding',
                ]);

                // A new property starts with the onboarding evidence task, so it
                // cannot quietly go live without a location assessment and the
                // statutory safety records.
                DB::table('workPlanActions')->insert([
                    'entityId' => $entityId,
                    'propertyId' => $id,
                    'title' => 'Complete property onboarding evidence',
                    'description' => 'Add location assessment, statutory safety evidence, insurance and responsible-person details before marking the property active.',
                    'sourceType' => 'property_onboarding',
                    'sourceId' => $id,
                    'priority' => 'high',
                    'dueAt' => Dates::nowMillis() + 14 * 86400000,
                    'createdBy' => $ctx->userId(),
                ]);

                return $id;
            });

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'action' => 'property.create',
                'resourceType' => 'property',
                'resourceId' => $propertyId,
                'result' => 'success',
            ]);

            return ['id' => $propertyId];
        });

        $registry->query('entities.propertyDetail', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyId = Validate::id($input['propertyId'] ?? null, 'propertyId');
            $access = Authz::assertCurrentShiftPropertyCapability($ctx->userId(), $entityId, $propertyId, 'property.read');

            $property = DB::table('properties')->where('id', $propertyId)->where('entityId', $entityId)->first();
            $units = DB::table('propertyUnits')->where('propertyId', $propertyId)->get()
                ->map(static fn ($row) => (array) $row)->all();

            $rawHistory = DB::table('occupancyEvents')
                ->where('propertyId', $propertyId)
                ->orderByDesc('effectiveAt')
                ->limit(50)
                ->get();

            $historyPlacementIds = [];
            foreach ($rawHistory as $event) {
                if ($event->placementId !== null && !in_array((int) $event->placementId, $historyPlacementIds, true)) {
                    $historyPlacementIds[] = (int) $event->placementId;
                }
            }

            // A support worker sees who lived in a room only for the young people
            // they key-work. Everyone else who can read the property sees the
            // occupancy history in full.
            if ($access['role'] === 'support_worker' && $historyPlacementIds !== []) {
                $permitted = DB::table('workerAssignments')
                    ->where('entityId', $entityId)
                    ->where('userId', $ctx->userId())
                    ->whereIn('placementId', $historyPlacementIds)
                    ->whereIn('assignmentRole', ['key_worker', 'co_worker'])
                    ->pluck('placementId')->map(static fn ($id) => (int) $id)->all();
            } else {
                $permitted = $historyPlacementIds;
            }

            $residents = [];
            if ($permitted !== []) {
                foreach (DB::table('placements as p')
                    ->join('youngPeople as y', 'y.id', '=', 'p.youngPersonId')
                    ->where('p.entityId', $entityId)
                    ->whereIn('p.id', $permitted)
                    ->select(['p.id as placementId', 'y.reference', 'y.preferredName'])
                    ->get() as $resident) {
                    $residents[(int) $resident->placementId] = (array) $resident;
                }
            }

            $history = [];
            foreach ($rawHistory as $event) {
                $row = (array) $event;
                $placementId = $event->placementId === null ? null : (int) $event->placementId;
                $row['occupant'] = $placementId !== null && in_array($placementId, $permitted, true)
                    ? ($residents[$placementId] ?? null)
                    : null;
                $history[] = $row;
            }

            return [
                'property' => $property === null ? null : (array) $property,
                'units' => $units,
                'history' => $history,
            ];
        });

        $registry->query('entities.unitOccupancy', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyId = Validate::id($input['propertyId'] ?? null, 'propertyId');
            $unitId = Validate::id($input['unitId'] ?? null, 'unitId');

            Authz::assertCurrentShiftPropertyCapability($ctx->userId(), $entityId, $propertyId, 'property.read');

            $unit = DB::table('propertyUnits')
                ->where('id', $unitId)->where('propertyId', $propertyId)
                ->first(['id', 'label', 'status']);

            if ($unit === null) {
                throw TrpcException::notFound('This room is not available at the selected property.');
            }

            $record = static function (string $reasonCode, ?string $sensitivity = null, ?int $placementId = null) use ($ctx, $entityId, $propertyId, $unit): void {
                Audit::write(array_filter([
                    'actorUserId' => $ctx->userId(),
                    'entityId' => $entityId,
                    'propertyId' => $propertyId,
                    'action' => 'unit_occupancy.read',
                    'resourceType' => 'property_unit',
                    'resourceId' => (int) $unit->id,
                    'sensitivity' => $sensitivity,
                    'result' => 'allowed',
                    'reasonCode' => $reasonCode,
                    'metadata' => $placementId === null ? null : ['placementId' => $placementId],
                ], static fn ($value) => $value !== null));
            };

            if ($unit->status !== 'occupied') {
                $record('unit_not_occupied');

                return ['state' => 'not_occupied', 'unit' => (array) $unit];
            }

            $event = DB::table('occupancyEvents')
                ->where('entityId', $entityId)->where('propertyId', $propertyId)->where('unitId', $unitId)
                ->orderByDesc('effectiveAt')->orderByDesc('id')
                ->first(['placementId', 'eventType']);

            if ($event === null || $event->placementId === null || $event->eventType !== 'move_in') {
                $record('assignment_not_recorded');

                return ['state' => 'assignment_not_recorded', 'unit' => (array) $unit];
            }

            // Naming the resident of a room is a young-person disclosure, so it
            // goes through the placement check rather than the property one.
            $placement = Authz::assertPlacementCapability($ctx->userId(), (int) $event->placementId, 'young_person.read')['placement'];

            if ((int) $placement['entityId'] !== $entityId
                || (int) ($placement['propertyId'] ?? 0) !== $propertyId
                || $placement['status'] !== 'active') {
                $record('assignment_not_current', 'safeguarding', (int) $event->placementId);

                return ['state' => 'assignment_not_current', 'unit' => (array) $unit];
            }

            $resident = DB::table('placements as p')
                ->join('youngPeople as y', 'y.id', '=', 'p.youngPersonId')
                ->where('p.id', (int) $event->placementId)
                ->where('p.entityId', $entityId)
                ->where('p.propertyId', $propertyId)
                ->where('p.status', 'active')
                ->first(['p.id as placementId', 'y.reference', 'y.preferredName', 'p.startAt as placementStartAt']);

            if ($resident === null) {
                $record('assignment_not_current', 'safeguarding', (int) $event->placementId);

                return ['state' => 'assignment_not_current', 'unit' => (array) $unit];
            }

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'action' => 'unit_occupancy.resident.read',
                'resourceType' => 'property_unit',
                'resourceId' => (int) $unit->id,
                'sensitivity' => 'safeguarding',
                'result' => 'allowed',
                'reasonCode' => 'property_and_placement_scope_verified',
                'metadata' => ['placementId' => (int) $resident->placementId],
            ]);

            return ['state' => 'assigned', 'unit' => (array) $unit, 'resident' => (array) $resident];
        });

        $registry->query('entities.propertyEvidence', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyId = Validate::id($input['propertyId'] ?? null, 'propertyId');

            // Safety, tenure and renewal paperwork is a manager's record. The
            // keyworker workspace is deliberately kept clear of it.
            if (($ctx->requireUser()['operationalRole'] ?? null) === 'support_worker') {
                throw TrpcException::forbidden(
                    'Property safety, tenure and renewal evidence is not available in the Keyworker workspace. [PROPERTY_EVIDENCE_KEYWORKER_RESTRICTED]'
                );
            }

            Authz::assertCurrentShiftPropertyCapability($ctx->userId(), $entityId, $propertyId, 'compliance.read');

            return DB::table('propertyEvidence')
                ->where('entityId', $entityId)->where('propertyId', $propertyId)
                ->orderByDesc('dueAt')
                ->get()
                ->map(static function ($row): array {
                    $item = (array) $row;
                    $completedAt = $row->status === 'closed'
                        ? (Dates::fromDatabase($row->updatedAt)?->getTimestamp() ?? 0) * 1000
                        : null;
                    $item['ragStatus'] = $row->dueAt
                        ? Rules::ragStatus((int) $row->dueAt, $completedAt, 30)
                        : 'grey';

                    return $item;
                })->all();
        });

        $registry->mutation('entities.createPropertyEvidence', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyId = Validate::id($input['propertyId'] ?? null, 'propertyId');
            Authz::assertPropertyCapability($ctx->userId(), $entityId, $propertyId, 'compliance.write');

            $recordType = Validate::enum($input['recordType'] ?? null, self::EVIDENCE_RECORD_TYPES, 'recordType');
            $title = Validate::string($input['title'] ?? null, 'title', 3, 240);
            $providerName = Validate::optionalString($input['providerName'] ?? null, 'providerName', 180);
            $reference = Validate::optionalString($input['reference'] ?? null, 'reference', 160);
            $issuedAt = isset($input['issuedAt']) ? Validate::int($input['issuedAt'], 'issuedAt') : null;
            $dueAt = isset($input['dueAt']) ? Validate::int($input['dueAt'], 'dueAt') : null;
            $documentId = Validate::optionalId($input['documentId'] ?? null, 'documentId');
            $details = isset($input['details']) ? Validate::object($input['details'], 'details') : null;

            $status = 'draft';
            if ($dueAt !== null) {
                $rag = Rules::ragStatus($dueAt, null, 30);
                $status = $rag === 'red' ? 'expired' : ($rag === 'amber' ? 'due_soon' : 'valid');
            }

            $recordId = DB::transaction(static function () use ($ctx, $entityId, $propertyId, $recordType, $title, $providerName, $reference, $issuedAt, $dueAt, $documentId, $details, $status): int {
                $id = (int) DB::table('propertyEvidence')->insertGetId([
                    'entityId' => $entityId,
                    'propertyId' => $propertyId,
                    'recordType' => $recordType,
                    'title' => $title,
                    'providerName' => $providerName,
                    'reference' => $reference,
                    'issuedAt' => $issuedAt,
                    'dueAt' => $dueAt,
                    'documentId' => $documentId,
                    'details' => $details === null ? null : json_encode($details, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                    'status' => $status,
                    'createdBy' => $ctx->userId(),
                ]);

                // A dated record also becomes a tracked obligation, which is what
                // puts it on the renewal board instead of leaving it to be
                // noticed by hand.
                if ($dueAt !== null) {
                    DB::table('complianceObligations')->insert([
                        'entityId' => $entityId,
                        'propertyId' => $propertyId,
                        'category' => 'property',
                        'requirementKey' => "property-evidence:$id",
                        'title' => $title,
                        'basis' => str_replace('_', ' ', $recordType),
                        'dueAt' => $dueAt,
                        'leadDays' => 30,
                        'evidenceDocumentId' => $documentId,
                        'sourceType' => 'property_evidence',
                        'sourceId' => $id,
                        'status' => $status === 'expired' ? 'overdue' : ($status === 'due_soon' ? 'due_soon' : 'not_due'),
                        'ragStatus' => $status === 'expired' ? 'red' : ($status === 'due_soon' ? 'amber' : 'green'),
                        'createdBy' => $ctx->userId(),
                    ]);
                }

                return $id;
            });

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'action' => 'property_evidence.create',
                'resourceType' => 'property_evidence',
                'resourceId' => $recordId,
                'result' => 'success',
                'metadata' => ['recordType' => $recordType, 'dueAt' => $dueAt],
            ]);

            return ['id' => $recordId];
        });

        $registry->query('entities.propertyComplianceWorkspace', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyIds = Authz::accessiblePropertyIds($ctx->userId(), $entityId, 'compliance.read');

            if ($propertyIds === []) {
                return ['properties' => [], 'documents' => [], 'records' => []];
            }

            $properties = DB::table('properties')
                ->where('entityId', $entityId)->whereIn('id', $propertyIds)
                ->select(['id', 'name', 'addressLine1', 'postcode'])->get();

            $documents = DB::table('documents')
                ->where('entityId', $entityId)->whereIn('propertyId', $propertyIds)->where('status', 'approved')
                ->select(['id', 'propertyId', 'title', 'status', 'documentType'])->get();

            $evidence = DB::table('propertyEvidence')
                ->where('entityId', $entityId)->whereIn('propertyId', $propertyIds)
                ->whereIn('recordType', ['licence', 'gas_safety', 'electrical_safety', 'fire_risk'])
                ->get();

            $propertyNames = [];
            foreach ($properties as $property) {
                $propertyNames[(int) $property->id] = $property->name;
            }

            $documentsById = [];
            foreach ($documents as $document) {
                $documentsById[(int) $document->id] = $document;
            }

            $records = [];
            foreach ($evidence as $row) {
                $details = is_string($row->details) ? json_decode($row->details, true) : $row->details;
                $kind = is_array($details) ? ($details['propertyComplianceKind'] ?? null) : null;
                if (!is_string($kind) || !in_array($kind, Rules::PROPERTY_COMPLIANCE_KINDS, true)) {
                    continue;
                }

                $document = $row->documentId === null ? null : ($documentsById[(int) $row->documentId] ?? null);
                $state = Rules::propertyRecordState((int) ($row->dueAt ?? 0), $document?->status === 'approved');

                $item = (array) $row;
                $item['kind'] = $kind;
                $item['notes'] = is_array($details) ? (string) ($details['notes'] ?? '') : '';
                $item['propertyName'] = $propertyNames[(int) $row->propertyId] ?? 'Property';
                $item['evidenceTitle'] = $document->title ?? null;
                $item['status'] = $state['status'];
                $item['ragStatus'] = $state['ragStatus'];
                $records[] = $item;
            }

            usort($records, static fn (array $a, array $b): int => ((int) ($a['dueAt'] ?? 0)) <=> ((int) ($b['dueAt'] ?? 0)));

            return [
                'properties' => $properties->map(static fn ($row) => (array) $row)->all(),
                'documents' => $documents->filter(static fn ($row) => in_array($row->documentType, ['certificate', 'evidence'], true))
                    ->map(static fn ($row) => (array) $row)->values()->all(),
                'records' => $records,
            ];
        });

        $registry->mutation('entities.createPropertyComplianceRecord', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyId = Validate::id($input['propertyId'] ?? null, 'propertyId');
            Authz::assertPropertyCapability($ctx->userId(), $entityId, $propertyId, 'compliance.write');

            $kind = Validate::enum($input['kind'] ?? null, Rules::PROPERTY_COMPLIANCE_KINDS, 'kind');
            $reference = Validate::string($input['reference'] ?? null, 'reference', 2, 160);
            $issuedAt = Validate::int($input['issuedAt'] ?? null, 'issuedAt');
            $dueAt = Validate::int($input['dueAt'] ?? null, 'dueAt');
            $providerName = Validate::string($input['providerName'] ?? null, 'providerName', 2, 180);
            $documentId = Validate::optionalId($input['documentId'] ?? null, 'documentId');
            $notes = Validate::optionalString($input['notes'] ?? null, 'notes', 2000) ?? '';

            Rules::assertPropertyRecordDates($issuedAt, $dueAt);

            $property = DB::table('properties')->where('id', $propertyId)->where('entityId', $entityId)->first(['id', 'name']);
            if ($property === null) {
                throw TrpcException::notFound('Property is not available in this entity');
            }

            $evidenceDocument = null;
            if ($documentId !== null) {
                $evidenceDocument = DB::table('documents')
                    ->where('id', $documentId)->where('entityId', $entityId)->where('propertyId', $propertyId)
                    ->first(['id', 'status']);

                if ($evidenceDocument === null) {
                    throw TrpcException::badRequest('Select an evidence document attached to this property');
                }
                // An unapproved document has not been checked by anyone, so it
                // cannot be what makes a compliance record valid.
                if ($evidenceDocument->status !== 'approved') {
                    throw TrpcException::badRequest('Evidence must be approved in Documents before it can validate this record');
                }
            }

            $state = Rules::propertyRecordState($dueAt, $evidenceDocument !== null);
            $title = Rules::PROPERTY_COMPLIANCE_LABELS[$kind] . ' — ' . $property->name;

            $recordId = DB::transaction(static function () use ($ctx, $entityId, $propertyId, $kind, $title, $providerName, $reference, $issuedAt, $dueAt, $documentId, $notes, $state): int {
                $id = (int) DB::table('propertyEvidence')->insertGetId([
                    'entityId' => $entityId,
                    'propertyId' => $propertyId,
                    'recordType' => Rules::PROPERTY_COMPLIANCE_RECORD_TYPES[$kind],
                    'title' => $title,
                    'providerName' => $providerName,
                    'reference' => $reference,
                    'issuedAt' => $issuedAt,
                    'dueAt' => $dueAt,
                    'status' => $state['status'],
                    'documentId' => $documentId,
                    'details' => json_encode(
                        ['propertyComplianceKind' => $kind, 'notes' => $notes],
                        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
                    ),
                    'createdBy' => $ctx->userId(),
                ]);

                DB::table('complianceObligations')->insert([
                    'entityId' => $entityId,
                    'propertyId' => $propertyId,
                    'category' => 'property',
                    'requirementKey' => "property-evidence:$id",
                    'title' => $title,
                    'basis' => Rules::PROPERTY_COMPLIANCE_LABELS[$kind],
                    'dueAt' => $dueAt,
                    'leadDays' => 30,
                    'evidenceDocumentId' => $documentId,
                    'sourceType' => 'property_evidence',
                    'sourceId' => $id,
                    'status' => Rules::obligationStatusFor($state['ragStatus']),
                    'ragStatus' => $state['ragStatus'],
                    'createdBy' => $ctx->userId(),
                ]);

                return $id;
            });

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'action' => 'property_compliance.create',
                'resourceType' => 'property_evidence',
                'resourceId' => $recordId,
                'result' => 'success',
                'metadata' => [
                    'kind' => $kind,
                    'dueAt' => $dueAt,
                    'evidenceDocumentId' => $documentId,
                    'status' => $state['status'],
                ],
            ]);

            return ['id' => $recordId, 'status' => $state['status']];
        });

        $registry->mutation('entities.linkPropertyComplianceEvidence', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $recordId = Validate::id($input['recordId'] ?? null, 'recordId');
            $documentId = Validate::id($input['documentId'] ?? null, 'documentId');

            $record = DB::table('propertyEvidence')->where('id', $recordId)->where('entityId', $entityId)->first();
            if ($record === null) {
                throw TrpcException::notFound('Property compliance record was not found');
            }

            Authz::assertPropertyCapability($ctx->userId(), $entityId, (int) $record->propertyId, 'compliance.write');

            $document = DB::table('documents')
                ->where('id', $documentId)->where('entityId', $entityId)->where('propertyId', $record->propertyId)
                ->first(['id', 'status']);

            if ($document === null) {
                throw TrpcException::badRequest('Select an evidence document attached to the same property');
            }
            if ($document->status !== 'approved') {
                throw TrpcException::badRequest('Evidence must be approved in Documents before it can validate this record');
            }

            $state = Rules::propertyRecordState((int) ($record->dueAt ?? 0), true);

            DB::transaction(static function () use ($record, $document, $state, $entityId): void {
                DB::table('propertyEvidence')->where('id', $record->id)->update([
                    'documentId' => $document->id,
                    'status' => $state['status'],
                ]);

                // The obligation tracks the same record, so it moves with it and
                // the renewal board cannot disagree with the evidence page.
                DB::table('complianceObligations')
                    ->where('sourceType', 'property_evidence')
                    ->where('sourceId', $record->id)
                    ->where('entityId', $entityId)
                    ->update([
                        'evidenceDocumentId' => $document->id,
                        'status' => Rules::obligationStatusFor($state['ragStatus']),
                        'ragStatus' => $state['ragStatus'],
                    ]);
            });

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'propertyId' => (int) $record->propertyId,
                'action' => 'property_compliance.evidence_link',
                'resourceType' => 'property_evidence',
                'resourceId' => (int) $record->id,
                'result' => 'success',
                'metadata' => ['documentId' => (int) $document->id, 'status' => $state['status']],
            ]);

            return ['success' => true, 'status' => $state['status']];
        });

        $registry->mutation('entities.createUnit', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyId = Validate::id($input['propertyId'] ?? null, 'propertyId');
            Authz::assertPropertyCapability($ctx->userId(), $entityId, $propertyId, 'property.write');

            $unitId = (int) DB::table('propertyUnits')->insertGetId([
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'label' => Validate::string($input['label'] ?? null, 'label', 1, 100),
                'unitType' => Validate::enum($input['unitType'] ?? null, self::UNIT_TYPES, 'unitType'),
                'capacity' => Validate::int($input['capacity'] ?? 1, 'capacity', 1, 10),
                'createdBy' => $ctx->userId(),
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'action' => 'property_unit.create',
                'resourceType' => 'property_unit',
                'resourceId' => $unitId,
                'result' => 'success',
            ]);

            return ['id' => $unitId];
        });

        $registry->mutation('entities.recordOccupancy', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyId = Validate::id($input['propertyId'] ?? null, 'propertyId');
            $unitId = Validate::id($input['unitId'] ?? null, 'unitId');
            Authz::assertPropertyCapability($ctx->userId(), $entityId, $propertyId, 'property.write');

            $placementId = Validate::optionalId($input['placementId'] ?? null, 'placementId');
            $eventType = Validate::enum($input['eventType'] ?? null, self::OCCUPANCY_EVENTS, 'eventType');
            $effectiveAt = Validate::int($input['effectiveAt'] ?? null, 'effectiveAt');
            $reason = Validate::optionalString($input['reason'] ?? null, 'reason', 2000);

            $eventId = DB::transaction(static function () use ($ctx, $entityId, $propertyId, $unitId, $placementId, $eventType, $effectiveAt, $reason): int {
                $id = (int) DB::table('occupancyEvents')->insertGetId([
                    'entityId' => $entityId,
                    'propertyId' => $propertyId,
                    'unitId' => $unitId,
                    'placementId' => $placementId,
                    'eventType' => $eventType,
                    'effectiveAt' => $effectiveAt,
                    'reason' => $reason,
                    'createdBy' => $ctx->userId(),
                ]);

                DB::table('propertyUnits')
                    ->where('id', $unitId)->where('propertyId', $propertyId)
                    ->update(['status' => self::OCCUPANCY_STATUS[$eventType]]);

                // The property's occupied-bed count is recalculated from the
                // rooms rather than adjusted, so it cannot drift away from them.
                $occupied = (int) DB::table('propertyUnits')
                    ->where('propertyId', $propertyId)->where('status', 'occupied')
                    ->sum('capacity');

                DB::table('properties')->where('id', $propertyId)->update(['occupiedBeds' => $occupied]);

                return $id;
            });

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'action' => "occupancy.$eventType",
                'resourceType' => 'occupancy_event',
                'resourceId' => $eventId,
                'result' => 'success',
                'metadata' => ['unitId' => $unitId, 'placementId' => $placementId],
            ]);

            return ['id' => $eventId];
        });

        $registry->query('entities.authorities', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'finance.read');

            return DB::table('localAuthorities')->where('entityId', $entityId)->get()
                ->map(static fn ($row) => (array) $row)->all();
        });

        $registry->mutation('entities.createAuthority', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'finance.write');

            $authorityId = (int) DB::table('localAuthorities')->insertGetId([
                'entityId' => $entityId,
                'name' => Validate::string($input['name'] ?? null, 'name', 2, 220),
                'addressLine1' => Validate::optionalString($input['addressLine1'] ?? null, 'addressLine1', 180),
                'city' => Validate::optionalString($input['city'] ?? null, 'city', 120),
                'postcode' => Validate::optionalString($input['postcode'] ?? null, 'postcode', 16),
                'financeEmail' => ($input['financeEmail'] ?? '') === '' ? null : Validate::email($input['financeEmail']),
                'placementEmail' => ($input['placementEmail'] ?? '') === '' ? null : Validate::email($input['placementEmail']),
                'paymentTermsDays' => Validate::int($input['paymentTermsDays'] ?? 30, 'paymentTermsDays', 0, 365),
                'defaultPurchaseOrderRequired' => Validate::bool($input['defaultPurchaseOrderRequired'] ?? false, 'defaultPurchaseOrderRequired') ? 1 : 0,
                'createdBy' => $ctx->userId(),
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'authority.create',
                'resourceType' => 'local_authority',
                'resourceId' => $authorityId,
                'result' => 'success',
            ]);

            return ['id' => $authorityId];
        });
    }
}
