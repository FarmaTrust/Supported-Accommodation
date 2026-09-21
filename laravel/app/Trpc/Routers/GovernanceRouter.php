<?php

declare(strict_types=1);

namespace App\Trpc\Routers;

use App\Support\Audit;
use App\Support\Authz;
use App\Support\Dates;
use App\Support\EvidenceStorage;
use App\Support\InspectionPack;
use App\Support\Retention;
use App\Trpc\Context;
use App\Trpc\Registry;
use App\Trpc\TrpcException;
use App\Trpc\Validate;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Throwable;

/**
 * governance.*, mirroring server/routers/governance.ts.
 *
 * The document library, the policies people have to sign, the retention
 * schedule that says when a record may be destroyed, and the inspection packs
 * handed to a regulator. The recurring theme is that a controlled record has
 * exactly one authorised way out of the system: a quality report, a printable
 * export or an inspection pack is refused by the generic document reader, so
 * it cannot be fetched around the workflow that reviews and audits it.
 */
final class GovernanceRouter
{
    private const CLASSIFICATIONS = ['general', 'hr', 'finance', 'safeguarding', 'bank', 'restricted'];

    private const TEMPLATE_CATEGORIES = [
        'provider_pack', 'support_plan', 'pathway_plan', 'risk_assessment', 'incident_notification',
        'supervision', 'placement_commencement', 'inspection_export', 'other',
    ];

    private const ALLOWED_MIME_TYPES = [
        'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic',
        'application/msword', 'text/plain', 'text/csv', 'application/json',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];

    private const MAX_UPLOAD_BYTES = 10485760;

    private const PACK_KIND = 'approved_quality_and_report_archive';

    private const DAY_MS = 86400000;

    public static function register(Registry $registry): void
    {
        self::registerLibrary($registry);
        self::registerRetention($registry);
        self::registerExports($registry);
    }

    // ------------------------------------------------------------- library

    private static function registerLibrary(Registry $registry): void
    {
        $registry->query('governance.folders', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'document.read');

            return DB::table('documentFolders')->where('entityId', $entityId)
                ->get()->map(static fn ($row) => self::timestamps((array) $row))->all();
        });

        $registry->mutation('governance.createFolder', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $parentFolderId = Validate::optionalId($input['parentFolderId'] ?? null, 'parentFolderId');
            $name = Validate::string($input['name'] ?? null, 'name', 2, 180);
            $classification = Validate::enum($input['classification'] ?? null, self::CLASSIFICATIONS, 'classification');

            Authz::assertEntityCapability($ctx->userId(), $entityId, 'document.write');

            $folderId = (int) DB::table('documentFolders')->insertGetId([
                'entityId' => $entityId,
                'parentFolderId' => $parentFolderId,
                'name' => $name,
                'classification' => $classification,
                'createdBy' => $ctx->userId(),
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => $entityId,
                'action' => 'document_folder.create', 'resourceType' => 'document_folder',
                'resourceId' => $folderId, 'sensitivity' => $classification, 'result' => 'success',
            ]);

            return ['id' => $folderId];
        });

        $registry->query('governance.templates', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'document.read');

            return DB::table('documentTemplates')->where('entityId', $entityId)->where('status', 'active')
                ->get()->map(static fn ($row) => self::templateRow($row))->all();
        });

        $registry->mutation('governance.createTemplate', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $templateKey = Validate::string($input['templateKey'] ?? null, 'templateKey', 2, 100);
            $title = Validate::string($input['title'] ?? null, 'title', 3, 220);
            $category = Validate::enum($input['category'] ?? null, self::TEMPLATE_CATEGORIES, 'category');
            $bodyTemplate = Validate::string($input['bodyTemplate'] ?? null, 'bodyTemplate', 20, 100000);
            $fieldSchema = isset($input['fieldSchema']) ? Validate::object($input['fieldSchema'], 'fieldSchema') : null;

            Authz::assertEntityCapability($ctx->userId(), $entityId, 'document.write');

            // A template is never edited in place: the new one supersedes the
            // old, so a document generated last year still points at the
            // wording it was actually produced from.
            $existing = DB::table('documentTemplates')
                ->where('entityId', $entityId)->where('templateKey', $templateKey)
                ->orderByDesc('version')->first(['id', 'version']);

            $version = ($existing === null ? 0 : (int) $existing->version) + 1;

            if ($existing !== null) {
                DB::table('documentTemplates')->where('id', (int) $existing->id)->update(['status' => 'superseded']);
            }

            $templateId = (int) DB::table('documentTemplates')->insertGetId([
                'entityId' => $entityId,
                'templateKey' => $templateKey,
                'title' => $title,
                'category' => $category,
                'bodyTemplate' => $bodyTemplate,
                'fieldSchema' => $fieldSchema === null ? null : self::json($fieldSchema),
                'version' => $version,
                'createdBy' => $ctx->userId(),
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => $entityId,
                'action' => 'document_template.create', 'resourceType' => 'document_template',
                'resourceId' => $templateId, 'result' => 'success',
                'metadata' => ['category' => $category, 'version' => $version],
            ]);

            return ['id' => $templateId, 'version' => $version];
        });

        $registry->query('governance.versions', Registry::USER, static function (Context $ctx, mixed $input): array {
            $documentId = Validate::id($input['documentId'] ?? null, 'documentId');
            $document = self::assertDocumentAccess($ctx->userId(), $documentId, 'read');

            $rows = DB::table('documentVersions')->where('documentId', $documentId)->orderByDesc('version')
                ->get([
                    'id', 'version', 'fileName', 'mimeType', 'sizeBytes', 'contentHash',
                    'scanStatus', 'changeSummary', 'approvedAt', 'createdAt',
                ])
                ->map(static fn ($row) => self::timestamps((array) $row))->all();

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => (int) $document->entityId,
                'propertyId' => $document->propertyId === null ? null : (int) $document->propertyId,
                'action' => 'document_versions.read', 'resourceType' => 'document',
                'resourceId' => (int) $document->id, 'sensitivity' => $document->classification,
                'result' => 'allowed', 'metadata' => ['resultCount' => count($rows)],
            ]);

            return $rows;
        });

        $registry->mutation('governance.uploadVersion', Registry::USER, static function (Context $ctx, mixed $input): array {
            $documentId = Validate::id($input['documentId'] ?? null, 'documentId');
            $fileName = Validate::string($input['fileName'] ?? null, 'fileName', 1, 300);
            $mimeType = Validate::string($input['mimeType'] ?? null, 'mimeType', 3, 160);
            $base64 = Validate::string($input['base64'] ?? null, 'base64', 1, 14500000, false);
            $changeSummary = Validate::optionalString($input['changeSummary'] ?? null, 'changeSummary', 2000);

            $document = self::assertDocumentAccess($ctx->userId(), $documentId, 'write');

            if (!in_array($mimeType, self::ALLOWED_MIME_TYPES, true)) {
                throw TrpcException::badRequest('This file type is not permitted');
            }

            $bytes = base64_decode($base64, true);
            if ($bytes === false || $bytes === '' || strlen($bytes) > self::MAX_UPLOAD_BYTES) {
                throw TrpcException::badRequest('Files must be between 1 byte and 10 MB');
            }

            $latest = DB::table('documentVersions')->where('documentId', $documentId)
                ->orderByDesc('version')->first('version');
            $version = ($latest === null ? 0 : (int) $latest->version) + 1;

            $safeName = mb_substr((string) preg_replace('/[^a-zA-Z0-9._-]+/', '-', $fileName), -180);
            $stored = EvidenceStorage::putBytes(
                "entities/{$document->entityId}/documents/{$document->id}/$version",
                $safeName,
                $mimeType,
                $bytes,
            );

            $versionId = (int) DB::table('documentVersions')->insertGetId([
                'documentId' => (int) $document->id,
                'version' => $version,
                'fileKey' => $stored['key'],
                'fileUrl' => $stored['url'],
                'fileName' => $safeName,
                'mimeType' => $mimeType,
                'sizeBytes' => $stored['sizeBytes'],
                'contentHash' => $stored['contentHash'],
                'scanStatus' => 'not_available',
                'changeSummary' => $changeSummary,
                'createdBy' => $ctx->userId(),
            ]);

            DB::table('documents')->where('id', (int) $document->id)->update(['currentVersion' => $version]);

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => (int) $document->entityId,
                'propertyId' => $document->propertyId === null ? null : (int) $document->propertyId,
                'action' => 'document_version.upload', 'resourceType' => 'document_version',
                'resourceId' => $versionId, 'sensitivity' => $document->classification, 'result' => 'success',
                'metadata' => [
                    'documentId' => (int) $document->id,
                    'version' => $version,
                    'sizeBytes' => $stored['sizeBytes'],
                    'contentHash' => $stored['contentHash'],
                    'scanStatus' => 'not_available',
                ],
            ]);

            return ['id' => $versionId, 'version' => $version, 'scanStatus' => 'not_available'];
        });

        $registry->mutation('governance.downloadVersion', Registry::USER, static function (Context $ctx, mixed $input): array {
            $documentId = Validate::id($input['documentId'] ?? null, 'documentId');
            $versionId = Validate::id($input['versionId'] ?? null, 'versionId');

            $document = self::assertDocumentAccess($ctx->userId(), $documentId, 'read');

            $version = DB::table('documentVersions')
                ->where('id', $versionId)->where('documentId', $documentId)->first();

            if ($version === null || $version->fileUrl === null || $version->scanStatus === 'quarantined') {
                throw TrpcException::notFound('File is unavailable');
            }

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => (int) $document->entityId,
                'propertyId' => $document->propertyId === null ? null : (int) $document->propertyId,
                'action' => 'document.download', 'resourceType' => 'document_version',
                'resourceId' => (int) $version->id, 'sensitivity' => $document->classification, 'result' => 'allowed',
                'metadata' => ['documentId' => (int) $document->id, 'version' => (int) $version->version],
            ]);

            return ['url' => $version->fileUrl, 'fileName' => $version->fileName];
        });

        $registry->mutation('governance.approveDocument', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $documentId = Validate::id($input['documentId'] ?? null, 'documentId');
            $acknowledgementDueAt = isset($input['acknowledgementDueAt'])
                ? Validate::int($input['acknowledgementDueAt'], 'acknowledgementDueAt')
                : null;

            $document = self::assertDocumentAccess($ctx->userId(), $documentId, 'write');
            if ((int) $document->entityId !== $entityId) {
                throw TrpcException::forbidden('Document access denied');
            }

            DB::transaction(static function () use ($document, $entityId, $documentId, $acknowledgementDueAt): void {
                DB::table('documents')->where('id', $documentId)->update(['status' => 'approved']);

                if ($document->documentType !== 'policy') {
                    return;
                }

                // Approving a policy is what puts it in front of every active
                // member; an existing receipt for this version is reopened so
                // the new wording is read rather than assumed.
                $members = DB::table('entityMemberships')
                    ->where('entityId', $entityId)->where('status', 'active')->get(['userId']);

                foreach ($members as $member) {
                    DB::table('policyAcknowledgements')->upsert([[
                        'entityId' => $entityId,
                        'documentId' => $documentId,
                        'documentVersion' => (int) $document->currentVersion,
                        'userId' => (int) $member->userId,
                        'dueAt' => $acknowledgementDueAt,
                        'status' => 'pending',
                        'acknowledgedAt' => null,
                    ]], ['documentId', 'documentVersion', 'userId'], ['dueAt', 'status', 'acknowledgedAt']);
                }
            });

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => $entityId,
                'action' => 'document.approve', 'resourceType' => 'document', 'resourceId' => $documentId,
                'sensitivity' => $document->classification, 'result' => 'success',
                'metadata' => ['version' => (int) $document->currentVersion],
            ]);

            return ['success' => true];
        });

        $registry->query('governance.myAcknowledgements', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'document.read');

            return DB::table('policyAcknowledgements as a')
                ->join('documents as d', 'd.id', '=', 'a.documentId')
                ->where('a.entityId', $entityId)->where('a.userId', $ctx->userId())
                ->get(['a.*', 'd.title'])
                ->map(static function ($row): array {
                    $record = self::timestamps((array) $row);
                    $title = $record['title'];
                    unset($record['title']);

                    return ['acknowledgement' => $record, 'title' => $title];
                })->all();
        });

        $registry->mutation('governance.acknowledgePolicy', Registry::USER, static function (Context $ctx, mixed $input): array {
            $id = Validate::id($input['id'] ?? null, 'id');

            $record = DB::table('policyAcknowledgements')
                ->where('id', $id)->where('userId', $ctx->userId())->first();

            if ($record === null) {
                throw TrpcException::notFound('Acknowledgement not found');
            }

            DB::table('policyAcknowledgements')->where('id', $id)
                ->update(['status' => 'acknowledged', 'acknowledgedAt' => Dates::nowMillis()]);

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => (int) $record->entityId,
                'action' => 'policy.acknowledge', 'resourceType' => 'policy_acknowledgement',
                'resourceId' => (int) $record->id, 'result' => 'success',
                'metadata' => ['documentId' => (int) $record->documentId, 'version' => (int) $record->documentVersion],
            ]);

            return ['success' => true];
        });
    }

    // ----------------------------------------------------------- retention

    private static function registerRetention(Registry $registry): void
    {
        $registry->query('governance.retentionReviews', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'document.write');

            return DB::table('retentionReviews')->where('entityId', $entityId)->orderByDesc('reviewDueAt')
                ->get()->map(static fn ($row) => self::timestamps((array) $row))->all();
        });

        $registry->mutation('governance.createRetentionReview', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $resourceType = Validate::string($input['resourceType'] ?? null, 'resourceType', 2, 80);
            $resourceId = Validate::id($input['resourceId'] ?? null, 'resourceId');
            $classification = Validate::enum($input['classification'] ?? null, self::CLASSIFICATIONS, 'classification');
            $retentionBasis = Validate::string($input['retentionBasis'] ?? null, 'retentionBasis', 5, 240);
            $retentionUntil = Validate::int($input['retentionUntil'] ?? null, 'retentionUntil');
            $reviewDueAt = Validate::int($input['reviewDueAt'] ?? null, 'reviewDueAt');
            $legalHold = Validate::bool($input['legalHold'] ?? null, 'legalHold');

            Authz::assertEntityCapability($ctx->userId(), $entityId, 'document.write');

            $reviewId = (int) DB::table('retentionReviews')->insertGetId([
                'entityId' => $entityId,
                'resourceType' => $resourceType,
                'resourceId' => $resourceId,
                'classification' => $classification,
                'retentionBasis' => $retentionBasis,
                'retentionUntil' => $retentionUntil,
                'reviewDueAt' => $reviewDueAt,
                'legalHold' => $legalHold ? 1 : 0,
                'status' => $legalHold ? 'hold' : 'pending',
                'requestedBy' => $ctx->userId(),
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => $entityId,
                'action' => 'retention_review.create', 'resourceType' => 'retention_review',
                'resourceId' => $reviewId, 'sensitivity' => $classification, 'result' => 'success',
                'metadata' => ['retentionBasis' => $retentionBasis, 'legalHold' => $legalHold],
            ]);

            return ['id' => $reviewId];
        });

        $registry->mutation('governance.decideRetentionReview', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $id = Validate::id($input['id'] ?? null, 'id');
            $decision = Validate::enum($input['decision'] ?? null, Retention::DECISIONS, 'decision');
            $notes = Validate::string($input['notes'] ?? null, 'notes', 5, 4000);

            Authz::assertEntityCapability($ctx->userId(), $entityId, 'document.write');

            $review = DB::table('retentionReviews')->where('id', $id)->where('entityId', $entityId)->first();
            if ($review === null) {
                throw TrpcException::notFound('Retention review not found');
            }

            $verdict = Retention::validateDecision(
                $review->requestedBy === null ? -1 : (int) $review->requestedBy,
                $ctx->userId(),
                (bool) $review->legalHold,
                $decision,
            );

            if (!$verdict['allowed']) {
                throw $verdict['reason'] === 'legal_hold'
                    ? new TrpcException('PRECONDITION_FAILED', 'Records under legal hold cannot be approved for deletion')
                    : TrpcException::forbidden('A different authorised person must approve deletion or transfer');
            }

            DB::table('retentionReviews')->where('id', $id)->update([
                'status' => $decision,
                'legalHold' => $decision === 'hold' ? 1 : (int) $review->legalHold,
                'approvedBy' => $ctx->userId(),
                'decisionAt' => Dates::nowMillis(),
                'decisionNotes' => $notes,
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => $entityId,
                'action' => 'retention_review.decide', 'resourceType' => 'retention_review',
                'resourceId' => $id, 'sensitivity' => $review->classification, 'result' => 'success',
                'metadata' => ['decision' => $decision],
            ]);

            return ['success' => true];
        });

        $registry->mutation('governance.completeDocumentDeletion', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $id = Validate::id($input['id'] ?? null, 'id');

            if (($input['confirmation'] ?? null) !== 'DELETE APPROVED RECORD') {
                throw TrpcException::badRequest('Type the confirmation phrase exactly to delete an approved record.');
            }

            Authz::assertEntityCapability($ctx->userId(), $entityId, 'document.write');

            $review = DB::table('retentionReviews')->where('id', $id)->where('entityId', $entityId)->first();

            if ($review === null || !Retention::canCompleteDeletion(
                (string) $review->status,
                (bool) $review->legalHold,
                (string) $review->resourceType,
            )) {
                throw new TrpcException('PRECONDITION_FAILED', 'This record is not approved for document deletion');
            }

            $resourceId = (int) $review->resourceId;
            $completedAt = Dates::nowMillis();

            // The version rows stay: what was held, by whom and when is part of
            // the record. Only the pointer to the bytes is destroyed.
            DB::transaction(static function () use ($resourceId, $entityId, $id, $completedAt): void {
                DB::table('documentVersions')->where('documentId', $resourceId)
                    ->update(['fileKey' => null, 'fileUrl' => null]);
                DB::table('documents')->where('id', $resourceId)->where('entityId', $entityId)
                    ->update(['status' => 'archived']);
                DB::table('retentionReviews')->where('id', $id)
                    ->update(['status' => 'completed', 'completedAt' => $completedAt]);
            });

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => $entityId,
                'action' => 'retention_delete.complete', 'resourceType' => 'document', 'resourceId' => $resourceId,
                'sensitivity' => $review->classification, 'result' => 'success',
                'metadata' => [
                    'retentionReviewId' => (int) $review->id,
                    'deletionReceipt' => hash('sha256', "{$review->id}:$resourceId:$completedAt"),
                ],
            ]);

            return ['success' => true];
        });
    }

    // ------------------------------------------------------------- exports

    private static function registerExports(Registry $registry): void
    {
        $registry->query('governance.exports', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'document.read');

            return DB::table('exportJobs')->where('entityId', $entityId)->orderByDesc('createdAt')
                ->get()->map(static fn ($row) => self::exportRow($row))->all();
        });

        $registry->query('governance.inspectionPacks', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyId = Validate::optionalId($input['propertyId'] ?? null, 'propertyId');

            self::assertInspectionPackAccess($ctx->userId(), $entityId, $propertyId);

            $query = DB::table('exportJobs')
                ->where('entityId', $entityId)->where('exportType', 'inspection')->orderByDesc('createdAt');

            if ($propertyId !== null) {
                $query->where('propertyId', $propertyId);
            }

            $packs = [];
            foreach ($query->get() as $row) {
                $scope = self::decode($row->scope);
                if (($scope['packKind'] ?? null) !== self::PACK_KIND) {
                    continue;
                }

                $manifest = self::decode($row->manifest);
                $packs[] = [
                    'id' => (int) $row->id,
                    'propertyId' => $row->propertyId === null ? null : (int) $row->propertyId,
                    'status' => $row->status,
                    'createdAt' => Dates::fromDatabase($row->createdAt),
                    'completedAt' => $row->completedAt === null ? null : (int) $row->completedAt,
                    'expiresAt' => $row->expiresAt === null ? null : (int) $row->expiresAt,
                    'counts' => $manifest['counts'] ?? [],
                    'errorCode' => $row->status === 'failed' ? 'INSPECTION_PACK_GENERATION_FAILED' : null,
                ];
            }

            return $packs;
        });

        $registry->mutation('governance.createInspectionPack', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyId = Validate::optionalId($input['propertyId'] ?? null, 'propertyId');

            $access = self::assertInspectionPackAccess($ctx->userId(), $entityId, $propertyId);

            $jobId = (int) DB::table('exportJobs')->insertGetId([
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'exportType' => 'inspection',
                'scope' => self::json(['packKind' => self::PACK_KIND, 'propertyId' => $propertyId ?? 'all']),
                'redaction' => self::json([
                    'noNarrativeInIndex' => true,
                    'platformNominatedIndividual' => $access['platformNominatedIndividual'],
                ]),
                'status' => 'generating',
                'requestedBy' => $ctx->userId(),
            ]);

            try {
                $entity = DB::table('entities')->where('id', $entityId)->first('name');
                if ($entity === null) {
                    throw new RuntimeException('Inspection pack entity missing');
                }

                $property = $propertyId === null
                    ? null
                    : DB::table('properties')->where('id', $propertyId)->where('entityId', $entityId)->first('name');

                // A Nominated Individual reviewing from outside the company sees
                // the quality reviews only; released operational reports stay
                // with the people accountable for the service.
                $sources = self::inspectionPackSources($entityId, $propertyId, !$access['platformNominatedIndividual']);
                $generatedAt = Dates::nowMillis();

                $manifest = [
                    'schemaVersion' => 1,
                    'generatedAt' => $generatedAt,
                    'entityId' => $entityId,
                    'propertyId' => $propertyId,
                    'requestedBy' => $ctx->userId(),
                    'packKind' => self::PACK_KIND,
                    'counts' => [
                        'approvedQualityReviews' => count($sources['reviews']),
                        'qualityEvidenceFiles' => $sources['qualityEvidenceFileCount'],
                        'otherReleasedReports' => $sources['otherReleasedReportCount'],
                        'bundledFiles' => count($sources['files']),
                    ],
                    'files' => array_map(static fn (array $file) => [
                        'source' => $file['source'],
                        'sourceId' => $file['sourceId'],
                        'reviewId' => $file['reviewId'] ?? null,
                        'title' => $file['title'],
                        'fileName' => $file['fileName'],
                        'mimeType' => $file['mimeType'],
                        'sizeBytes' => $file['sizeBytes'],
                        'contentHash' => $file['contentHash'],
                    ], $sources['files']),
                ];

                $bytes = InspectionPack::createZip(
                    $manifest,
                    (string) $entity->name,
                    $property === null ? null : (string) $property->name,
                    $sources['reviews'],
                    $sources['files'],
                );

                $fileName = InspectionPack::fileName($jobId, $generatedAt);
                $stored = EvidenceStorage::putBytes(
                    "entities/$entityId/inspection-packs/$jobId",
                    $fileName,
                    'application/zip',
                    $bytes,
                );

                $documentId = (int) DB::table('documents')->insertGetId([
                    'entityId' => $entityId,
                    'propertyId' => $propertyId,
                    'title' => 'Inspection pack · ' . gmdate('Y-m-d', intdiv($generatedAt, 1000)),
                    'documentType' => 'generated',
                    'classification' => 'restricted',
                    'status' => 'approved',
                    'retentionBasis' => 'Inspection pack archive — review after inspection purpose is completed',
                    'retentionUntil' => $generatedAt + 365 * self::DAY_MS,
                    'createdBy' => $ctx->userId(),
                ]);

                DB::table('documentVersions')->insert([
                    'documentId' => $documentId,
                    'version' => 1,
                    'fileKey' => $stored['key'],
                    'fileUrl' => $stored['url'],
                    'fileName' => $fileName,
                    'mimeType' => 'application/zip',
                    'sizeBytes' => strlen($bytes),
                    'contentHash' => InspectionPack::contentHash($bytes),
                    'scanStatus' => 'not_available',
                    'changeSummary' => 'System-generated controlled inspection pack with approved quality reviews, reviewed evidence and released reports',
                    'approvedAt' => $generatedAt,
                    'approvedBy' => $ctx->userId(),
                    'createdBy' => $ctx->userId(),
                ]);

                DB::table('exportJobs')->where('id', $jobId)->update([
                    'status' => 'ready',
                    'manifest' => self::json($manifest),
                    'documentId' => $documentId,
                    'completedAt' => $generatedAt,
                    'expiresAt' => $generatedAt + 30 * self::DAY_MS,
                ]);

                Audit::write([
                    'actorUserId' => $ctx->userId(), 'entityId' => $entityId, 'propertyId' => $propertyId,
                    'action' => 'inspection_pack.create', 'resourceType' => 'export_job', 'resourceId' => $jobId,
                    'sensitivity' => 'restricted', 'result' => 'success',
                    'metadata' => [
                        'documentId' => $documentId,
                        'counts' => $manifest['counts'],
                        'platformNominatedIndividual' => $access['platformNominatedIndividual'],
                    ],
                ]);

                return ['id' => $jobId, 'status' => 'ready', 'counts' => $manifest['counts']];
            } catch (Throwable $error) {
                // The failed job row is kept deliberately: a pack that could not
                // be produced is itself something an inspection may ask about.
                DB::table('exportJobs')->where('id', $jobId)
                    ->update(['status' => 'failed', 'errorMessage' => 'Inspection pack generation failed']);

                Audit::write([
                    'actorUserId' => $ctx->userId(), 'entityId' => $entityId, 'propertyId' => $propertyId,
                    'action' => 'inspection_pack.create', 'resourceType' => 'export_job', 'resourceId' => $jobId,
                    'sensitivity' => 'restricted', 'result' => 'failure',
                    'reasonCode' => 'INSPECTION_PACK_GENERATION_FAILED',
                ]);

                throw new TrpcException(
                    'INTERNAL_SERVER_ERROR',
                    'The inspection pack could not be generated. The failed request is retained for audit review.',
                );
            }
        });

        $registry->mutation('governance.downloadInspectionPack', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $id = Validate::id($input['id'] ?? null, 'id');

            $job = DB::table('exportJobs')
                ->where('id', $id)->where('entityId', $entityId)->where('exportType', 'inspection')->first();

            if ($job === null || (self::decode($job->scope)['packKind'] ?? null) !== self::PACK_KIND) {
                throw TrpcException::notFound('Inspection pack not found.');
            }

            $propertyId = $job->propertyId === null ? null : (int) $job->propertyId;
            self::assertInspectionPackAccess($ctx->userId(), $entityId, $propertyId);

            if ($job->documentId === null || $job->status !== 'ready'
                || ($job->expiresAt !== null && (int) $job->expiresAt < Dates::nowMillis())
            ) {
                throw new TrpcException('PRECONDITION_FAILED', 'This inspection pack is unavailable or has expired.');
            }

            $version = DB::table('documentVersions')
                ->where('documentId', (int) $job->documentId)->where('version', 1)->first();

            if ($version === null || $version->fileUrl === null) {
                throw TrpcException::notFound('The inspection pack file is unavailable.');
            }

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => $entityId, 'propertyId' => $propertyId,
                'action' => 'inspection_pack.download', 'resourceType' => 'export_job', 'resourceId' => (int) $job->id,
                'sensitivity' => 'restricted', 'result' => 'allowed',
                'metadata' => [
                    'documentId' => (int) $job->documentId,
                    'fileCount' => (int) (self::decode($job->manifest)['counts']['bundledFiles'] ?? 0),
                ],
            ]);

            return [
                'url' => $version->fileUrl,
                'fileName' => $version->fileName ?? InspectionPack::fileName((int) $job->id, Dates::nowMillis()),
            ];
        });

        $registry->mutation('governance.createInspectionExport', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyId = Validate::optionalId($input['propertyId'] ?? null, 'propertyId');
            $includeDocumentIndex = Validate::bool($input['includeDocumentIndex'] ?? null, 'includeDocumentIndex', true);
            $redactYoungPersonReferences = Validate::bool($input['redactYoungPersonReferences'] ?? null, 'redactYoungPersonReferences', true);

            Authz::assertEntityCapability($ctx->userId(), $entityId, 'document.write');
            if ($propertyId !== null) {
                Authz::assertPropertyCapability($ctx->userId(), $entityId, $propertyId, 'compliance.read');
            }

            $jobId = (int) DB::table('exportJobs')->insertGetId([
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'exportType' => 'inspection',
                'scope' => self::json(['propertyId' => $propertyId ?? 'all']),
                'redaction' => self::json(['youngPersonReferences' => $redactYoungPersonReferences]),
                'status' => 'generating',
                'requestedBy' => $ctx->userId(),
            ]);

            try {
                $scoped = static function (string $table) use ($entityId, $propertyId) {
                    $query = DB::table($table)->where('entityId', $entityId);
                    if ($propertyId !== null) {
                        $query->where('propertyId', $propertyId);
                    }

                    return $query;
                };

                $propertyQuery = DB::table('properties');
                if ($propertyId !== null) {
                    $propertyQuery->where('id', $propertyId);
                } else {
                    $propertyQuery->where('entityId', $entityId);
                }

                $properties = $propertyQuery->get()->map(static fn ($row) => (array) $row)->all();
                $evidence = $scoped('propertyEvidence')->get()->map(static fn ($row) => (array) $row)->all();
                $compliance = $scoped('complianceObligations')->get()->map(static fn ($row) => (array) $row)->all();
                $workPlans = $scoped('workPlanActions')->get()->map(static fn ($row) => (array) $row)->all();

                $documents = !$includeDocumentIndex ? [] : DB::table('documents')
                    ->where('entityId', $entityId)
                    ->get(['id', 'title', 'documentType as type', 'classification', 'status', 'currentVersion', 'reviewDueAt'])
                    ->map(static fn ($row) => (array) $row)->all();

                $generatedAt = Dates::nowMillis();
                $manifest = [
                    'schemaVersion' => 1,
                    'generatedAt' => $generatedAt,
                    'generatedBy' => $ctx->userId(),
                    'entityId' => $entityId,
                    'propertyId' => $propertyId,
                    'redaction' => ['youngPersonReferences' => $redactYoungPersonReferences],
                    'counts' => [
                        'properties' => count($properties),
                        'propertyEvidence' => count($evidence),
                        'compliance' => count($compliance),
                        'workPlans' => count($workPlans),
                        'documents' => count($documents),
                    ],
                    'sections' => $includeDocumentIndex
                        ? ['properties', 'propertyEvidence', 'compliance', 'workPlans', 'documents']
                        : ['properties', 'propertyEvidence', 'compliance', 'workPlans'],
                ];

                $payload = InspectionPack::json([
                    'manifest' => $manifest,
                    'properties' => $properties,
                    'propertyEvidence' => $evidence,
                    'compliance' => $compliance,
                    'workPlans' => $workPlans,
                    'documents' => $documents,
                ]);

                $stored = EvidenceStorage::putBytes(
                    "entities/$entityId/exports",
                    "inspection-$jobId-$generatedAt.json",
                    'application/json',
                    $payload,
                );

                $documentId = (int) DB::table('documents')->insertGetId([
                    'entityId' => $entityId,
                    'propertyId' => $propertyId,
                    'title' => 'Inspection evidence export ' . gmdate('Y-m-d', intdiv($generatedAt, 1000)),
                    'documentType' => 'generated',
                    'classification' => 'restricted',
                    'status' => 'approved',
                    'retentionBasis' => 'Inspection evidence export — review after purpose completed',
                    'retentionUntil' => $generatedAt + 365 * self::DAY_MS,
                    'createdBy' => $ctx->userId(),
                ]);

                DB::table('documentVersions')->insert([
                    'documentId' => $documentId,
                    'version' => 1,
                    'fileKey' => $stored['key'],
                    'fileUrl' => $stored['url'],
                    'fileName' => "inspection-export-$jobId.json",
                    'mimeType' => 'application/json',
                    'sizeBytes' => strlen($payload),
                    'contentHash' => hash('sha256', $payload),
                    'scanStatus' => 'not_available',
                    'changeSummary' => 'System-generated inspection evidence manifest',
                    'approvedAt' => $generatedAt,
                    'approvedBy' => $ctx->userId(),
                    'createdBy' => $ctx->userId(),
                ]);

                DB::table('exportJobs')->where('id', $jobId)->update([
                    'status' => 'ready',
                    'manifest' => self::json($manifest),
                    'documentId' => $documentId,
                    'completedAt' => $generatedAt,
                    'expiresAt' => $generatedAt + 30 * self::DAY_MS,
                ]);

                Audit::write([
                    'actorUserId' => $ctx->userId(), 'entityId' => $entityId, 'propertyId' => $propertyId,
                    'action' => 'inspection_export.create', 'resourceType' => 'export_job', 'resourceId' => $jobId,
                    'sensitivity' => 'restricted', 'result' => 'success',
                    'metadata' => [
                        'documentId' => $documentId,
                        'counts' => $manifest['counts'],
                        'redaction' => $manifest['redaction'],
                    ],
                ]);

                return ['id' => $jobId, 'status' => 'ready'];
            } catch (Throwable $error) {
                DB::table('exportJobs')->where('id', $jobId)
                    ->update(['status' => 'failed', 'errorMessage' => $error->getMessage()]);

                throw $error;
            }
        });

        $registry->mutation('governance.downloadExport', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $id = Validate::id($input['id'] ?? null, 'id');

            Authz::assertEntityCapability($ctx->userId(), $entityId, 'document.read');

            $job = DB::table('exportJobs')->where('id', $id)->where('entityId', $entityId)->first();

            if ($job === null || $job->documentId === null || $job->status !== 'ready'
                || ($job->expiresAt !== null && (int) $job->expiresAt < Dates::nowMillis())
            ) {
                throw new TrpcException('PRECONDITION_FAILED', 'Export is unavailable or expired');
            }

            $version = DB::table('documentVersions')
                ->where('documentId', (int) $job->documentId)->orderByDesc('version')->first();

            if ($version === null || $version->fileUrl === null) {
                throw TrpcException::notFound('Export file not found');
            }

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => $entityId,
                'propertyId' => $job->propertyId === null ? null : (int) $job->propertyId,
                'action' => 'inspection_export.download', 'resourceType' => 'export_job', 'resourceId' => (int) $job->id,
                'sensitivity' => 'restricted', 'result' => 'allowed',
                'metadata' => ['documentId' => (int) $job->documentId],
            ]);

            return ['url' => $version->fileUrl, 'fileName' => $version->fileName];
        });
    }

    // -------------------------------------------------------------- shared

    /**
     * A controlled record has one authorised way out of the system. A quality
     * report, a printable export or an inspection pack is refused here, so it
     * cannot be fetched around the workflow that reviews and audits it.
     */
    private static function assertDocumentAccess(int $userId, int $documentId, string $action): object
    {
        $document = DB::table('documents')->where('id', $documentId)->first();
        if ($document === null) {
            throw TrpcException::notFound('Document not found');
        }

        if (DB::table('printableRecordExports')->where('documentId', $documentId)->exists()) {
            throw TrpcException::forbidden('Controlled printable records can only be opened through their authorised export workflow.');
        }

        if (DB::table('qualityReviews')->where('reportDocumentId', $documentId)->exists()
            || DB::table('qualityReviewEvidence')->where('documentId', $documentId)->exists()
        ) {
            throw TrpcException::forbidden('Quality-review reports and evidence can only be opened through their authorised quality-review workflow.');
        }

        if (DB::table('exportJobs')->where('documentId', $documentId)->where('exportType', 'inspection')->exists()) {
            throw TrpcException::forbidden('Inspection packs can only be opened through the authorised inspection-pack workflow.');
        }

        $entityId = (int) $document->entityId;
        Authz::assertEntityCapability($userId, $entityId, $action === 'write' ? 'document.write' : 'document.read');

        // The classification decides which second capability applies: reaching
        // a document does not imply the right to read what is in it.
        $extra = match ($document->classification) {
            'hr' => 'staff.read',
            'finance', 'bank' => 'finance.read',
            'safeguarding' => 'young_person.read',
            default => null,
        };

        if ($extra !== null) {
            Authz::assertEntityCapability($userId, $entityId, $extra);
        }

        return $document;
    }

    /**
     * Inspection packs are deliberately narrower than the generic document
     * library: accountable quality-review roles and a platform administrator
     * acting as the Nominated Individual, never frontline users.
     *
     * @return array{platformNominatedIndividual: bool, role: string}
     */
    private static function assertInspectionPackAccess(int $userId, int $entityId, ?int $propertyId = null): array
    {
        $access = Authz::userAccess($userId);

        $member = false;
        foreach ($access['memberships'] as $membership) {
            if ($membership['entityId'] === $entityId) {
                $member = true;
                break;
            }
        }

        if (!$member) {
            throw TrpcException::forbidden('Inspection-pack access is restricted to an authorised entity.');
        }

        if (DB::table('entities')->where('id', $entityId)->first('id') === null) {
            throw TrpcException::notFound('Entity not found.');
        }

        $platformNominatedIndividual = $access['user']['operationalRole'] === 'platform_admin';

        if ($platformNominatedIndividual) {
            return ['platformNominatedIndividual' => true, 'role' => 'platform_admin'];
        }

        $entityAccess = Authz::assertEntityCapability($userId, $entityId, 'compliance.read');
        if (!in_array($entityAccess['role'], ['owner', 'registered_manager'], true)) {
            throw TrpcException::forbidden('Inspection packs are available only to an Owner, RSM/Manager or Nominated Individual.');
        }

        if ($propertyId !== null) {
            Authz::assertPropertyCapability($userId, $entityId, $propertyId, 'compliance.read');
        }

        return ['platformNominatedIndividual' => false, 'role' => (string) $entityAccess['role']];
    }

    /**
     * The approved quality reviews, their reviewed evidence and the released
     * printable reports that belong in one pack.
     *
     * @return array{reviews: array<int, array<string, mixed>>, files: array<int, array<string, mixed>>, qualityEvidenceFileCount: int, otherReleasedReportCount: int}
     */
    private static function inspectionPackSources(int $entityId, ?int $propertyId, bool $includeReleasedOperationalReports): array
    {
        $reviewQuery = DB::table('qualityReviews as q')
            ->leftJoin('properties as p', 'p.id', '=', 'q.propertyId')
            ->where('q.entityId', $entityId)
            ->whereIn('q.status', ['approved', 'submitted'])
            ->orderByDesc('q.periodEnd');

        if ($propertyId !== null) {
            $reviewQuery->where('q.propertyId', $propertyId);
        }

        $reviewRows = $reviewQuery->get(['q.*', 'p.name as propertyName'])->all();
        $reviewIds = array_map(static fn ($row) => (int) $row->id, $reviewRows);

        $reportFiles = [];
        foreach ($reviewRows as $row) {
            $reviewId = (int) $row->id;

            // A review approved without its controlled PDF cannot be evidenced,
            // so the pack fails rather than quietly omitting it.
            if ($row->reportDocumentId === null) {
                throw new TrpcException('PRECONDITION_FAILED', "Approved quality review QSR-$reviewId does not have its controlled report PDF.");
            }

            $version = DB::table('documentVersions')
                ->where('documentId', (int) $row->reportDocumentId)->where('version', 2)->first();

            if ($version === null || $version->scanStatus === 'quarantined') {
                throw new TrpcException('PRECONDITION_FAILED', "The controlled report PDF for QSR-$reviewId is unavailable.");
            }

            $reportFiles[] = self::sourceFile([
                'source' => 'quality_report',
                'sourceId' => $reviewId,
                'reviewId' => $reviewId,
                'propertyName' => $row->propertyName,
                'title' => $row->title,
            ], $version);
        }

        $evidenceRows = $reviewIds === [] ? [] : DB::table('qualityReviewEvidence as e')
            ->join('qualityReviews as q', 'q.id', '=', 'e.qualityReviewId')
            ->leftJoin('properties as p', 'p.id', '=', 'q.propertyId')
            ->join('documentVersions as v', 'v.documentId', '=', 'e.documentId')
            ->whereIn('e.qualityReviewId', $reviewIds)
            ->where('e.status', 'reviewed')
            ->get([
                'e.id', 'e.qualityReviewId', 'e.title', 'p.name as propertyName',
                'v.fileKey', 'v.fileName', 'v.mimeType', 'v.sizeBytes', 'v.contentHash', 'v.scanStatus',
            ])->all();

        $evidenceFiles = [];
        foreach ($evidenceRows as $row) {
            if ($row->scanStatus === 'quarantined') {
                continue;
            }

            $evidenceFiles[] = self::sourceFile([
                'source' => 'quality_evidence',
                'sourceId' => (int) $row->id,
                'reviewId' => (int) $row->qualityReviewId,
                'propertyName' => $row->propertyName,
                'title' => $row->title,
            ], $row);
        }

        $operationalFiles = [];
        if ($includeReleasedOperationalReports) {
            $exportQuery = DB::table('printableRecordExports as r')
                ->join('documentVersions as v', 'v.documentId', '=', 'r.documentId')
                ->leftJoin('properties as p', 'p.id', '=', 'r.propertyId')
                ->where('r.entityId', $entityId)
                ->where('r.status', 'ready');

            if ($propertyId !== null) {
                $exportQuery->where('r.propertyId', $propertyId);
            }

            foreach ($exportQuery->get([
                'r.id', 'r.exportType', 'p.name as propertyName',
                'v.version', 'v.fileKey', 'v.fileName', 'v.mimeType', 'v.sizeBytes', 'v.contentHash', 'v.scanStatus',
            ]) as $row) {
                $required = $row->exportType === 'young_person_compilation' ? 2 : 1;
                if ((int) $row->version !== $required || $row->scanStatus === 'quarantined') {
                    continue;
                }

                $operationalFiles[] = self::sourceFile([
                    'source' => 'printable_report',
                    'sourceId' => (int) $row->id,
                    'propertyName' => $row->propertyName,
                    'title' => str_replace('_', ' ', (string) $row->exportType) . ' #' . $row->id,
                ], $row);
            }
        }

        $reviews = array_map(static function ($row) use ($evidenceRows): array {
            $reviewId = (int) $row->id;

            return [
                'id' => $reviewId,
                'title' => $row->title,
                'propertyName' => $row->propertyName,
                'periodStart' => (int) $row->periodStart,
                'periodEnd' => (int) $row->periodEnd,
                'approvedAt' => $row->approvedAt === null ? null : (int) $row->approvedAt,
                'evidenceCount' => count(array_filter(
                    $evidenceRows,
                    static fn ($item) => (int) $item->qualityReviewId === $reviewId,
                )),
            ];
        }, $reviewRows);

        return [
            'reviews' => $reviews,
            'files' => [...$reportFiles, ...$evidenceFiles, ...$operationalFiles],
            'qualityEvidenceFileCount' => count($evidenceFiles),
            'otherReleasedReportCount' => count($operationalFiles),
        ];
    }

    /**
     * @param array<string, mixed> $descriptor
     * @return array<string, mixed>
     */
    private static function sourceFile(array $descriptor, object $version): array
    {
        if (($version->fileKey ?? null) === null || ($version->fileName ?? null) === null) {
            throw new TrpcException('PRECONDITION_FAILED', 'An approved inspection source file is unavailable.');
        }

        return $descriptor + [
            'fileKey' => (string) $version->fileKey,
            'fileName' => (string) $version->fileName,
            'mimeType' => $version->mimeType,
            'sizeBytes' => $version->sizeBytes === null ? null : (int) $version->sizeBytes,
            'contentHash' => $version->contentHash,
        ];
    }

    /** @return array<string, mixed> */
    private static function decode(mixed $value): array
    {
        if (is_array($value)) {
            return $value;
        }
        if (!is_string($value) || $value === '') {
            return [];
        }

        $decoded = json_decode($value, true);

        return is_array($decoded) ? $decoded : [];
    }

    /** @param array<string, mixed> $value */
    private static function json(array $value): string
    {
        return json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }

    /** @return array<string, mixed> */
    private static function templateRow(object $row): array
    {
        $template = self::timestamps((array) $row);
        $template['fieldSchema'] = $template['fieldSchema'] === null ? null : self::decode($template['fieldSchema']);

        return $template;
    }

    /** @return array<string, mixed> */
    private static function exportRow(object $row): array
    {
        $job = self::timestamps((array) $row);
        foreach (['scope', 'redaction', 'manifest'] as $field) {
            $job[$field] = $job[$field] === null ? null : self::decode($job[$field]);
        }

        return $job;
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private static function timestamps(array $row): array
    {
        foreach (['createdAt', 'updatedAt'] as $field) {
            if (array_key_exists($field, $row)) {
                $row[$field] = Dates::fromDatabase($row[$field]);
            }
        }

        return $row;
    }
}
