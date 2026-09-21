<?php

declare(strict_types=1);

namespace App\Trpc\Routers;

use App\Support\Audit;
use App\Support\Authz;
use App\Support\Dates;
use App\Support\EvidenceStorage;
use App\Support\QualityReviewPdf;
use App\Support\QualityReviewRules;
use App\Support\Users;
use App\Trpc\Context;
use App\Trpc\Registry;
use App\Trpc\TrpcException;
use App\Trpc\Validate;
use Illuminate\Support\Facades\DB;

/**
 * quality.*, mirroring server/routers/quality.ts.
 *
 * The Regulation 32 quality of support review: consult everybody who has a view,
 * gather the evidence, write the judgement, have somebody else approve it, send
 * it to the regulator. Each of those is a state the review moves through, and
 * the router will not let one be skipped.
 *
 * The one deliberate difference from Node is in how the approved PDF is made.
 * Node keeps the draft bytes and adds a certificate page to them. FPDF cannot
 * import an existing PDF, so the approved copy is rendered afresh — but only
 * after checking that no consultation or evidence row has changed since the
 * draft was prepared. A review that moved on is refused rather than
 * re-rendered, which is stricter than appending: appending would have certified
 * bytes whose source had since changed.
 */
final class QualityRouter
{
    private const DAY_MS = 86400000;

    /** The report narrative, written in one go at completion. */
    private const REPORT_FIELDS = [
        'methodology' => 20,
        'strengths' => 10,
        'shortfalls' => 10,
        'outcomesSummary' => 10,
        'youngPeopleSummary' => 10,
        'consultationSummary' => 10,
        'managementEvaluation' => 10,
    ];

    private const AUDIENCES = ['young_person', 'placing_authority', 'staff', 'professional', 'family_advocate', 'other'];
    private const METHODS = ['conversation', 'meeting', 'telephone', 'email', 'survey', 'written', 'advocate', 'other'];
    private const RESPONSE_STATUSES = ['planned', 'invited', 'responded', 'declined', 'no_response', 'not_applicable'];
    private const EVIDENCE_CATEGORIES = [
        'outcomes', 'safeguarding', 'staffing', 'placement_stability', 'complaints',
        'incidents', 'compliance', 'feedback', 'education_health', 'independence', 'other',
    ];
    private const EVIDENCE_STATUSES = ['identified', 'collected', 'reviewed', 'excluded'];
    private const SUBMISSION_METHODS = ['email', 'portal', 'secure_link', 'post', 'other'];

    private const MAX_EVIDENCE_FILES = 8;
    private const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;

    public static function register(Registry $registry): void
    {
        $registry->query('quality.workspace', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $access = self::assertQualityAccess($ctx, $entityId, 'compliance.read');

            $propertyIds = $access['role'] === 'platform_admin'
                ? DB::table('properties')->where('entityId', $entityId)->pluck('id')->map(static fn ($id) => (int) $id)->all()
                : Authz::accessiblePropertyIds($ctx->userId(), $entityId, 'property.read');

            // A review with no property is the company's own; only somebody who
            // reaches the whole company sees it.
            $wholeCompany = $access['role'] === 'owner' || ($access['allProperties'] ?? false);

            $reviews = [];
            $ids = [];
            foreach (DB::table('qualityReviews')->where('entityId', $entityId)->orderByDesc('periodEnd')->get() as $row) {
                $propertyId = $row->propertyId === null ? null : (int) $row->propertyId;
                if ($propertyId === null ? !$wholeCompany : !in_array($propertyId, $propertyIds, true)) {
                    continue;
                }
                $reviews[] = (array) $row;
                $ids[] = (int) $row->id;
            }

            return [
                'reviews' => $reviews,
                'consultations' => $ids === [] ? [] : DB::table('qualityReviewConsultations')
                    ->whereIn('qualityReviewId', $ids)->get()->map(static fn ($r) => (array) $r)->all(),
                'evidence' => $ids === [] ? [] : DB::table('qualityReviewEvidence')
                    ->whereIn('qualityReviewId', $ids)->get()->map(static fn ($r) => (array) $r)->all(),
            ];
        });

        $registry->mutation('quality.createReview', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $periodStart = Validate::int($input['periodStart'] ?? null, 'periodStart');
            $periodEnd = Validate::int($input['periodEnd'] ?? null, 'periodEnd');

            // The period is checked first, as on the Node side: a six-month
            // window is the regulation, not a preference.
            $periodError = QualityReviewRules::periodError($periodStart, $periodEnd);
            if ($periodError !== null) {
                throw TrpcException::badRequest($periodError);
            }

            self::assertQualityAccess($ctx, $entityId, 'compliance.write');

            $propertyId = Validate::optionalId($input['propertyId'] ?? null, 'propertyId');
            if ($propertyId !== null) {
                Authz::assertPropertyCapability($ctx->userId(), $entityId, $propertyId, 'compliance.write');
            }

            $id = (int) DB::table('qualityReviews')->insertGetId([
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'title' => Validate::string($input['title'] ?? null, 'title', 3, 220),
                'periodStart' => $periodStart,
                'periodEnd' => $periodEnd,
                'ownerUserId' => Validate::optionalId($input['ownerUserId'] ?? null, 'ownerUserId'),
                // Both clocks run from the end of the period, so the diary is
                // right from the moment the review is opened.
                'submissionDueAt' => $periodEnd + 28 * self::DAY_MS,
                'nextReviewDueAt' => $periodEnd + 183 * self::DAY_MS,
                'createdBy' => $ctx->userId(),
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'action' => 'quality_review.create',
                'resourceType' => 'quality_review',
                'resourceId' => $id,
                'sensitivity' => 'restricted',
                'result' => 'success',
            ]);

            return ['id' => $id];
        });

        $registry->mutation('quality.addConsultation', Registry::USER, static function (Context $ctx, mixed $input): array {
            [$entityId, $review] = self::reviewForWrite($ctx, $input);
            self::assertAmendable($review);

            $responseStatus = Validate::enum($input['responseStatus'] ?? null, self::RESPONSE_STATUSES, 'responseStatus');
            $now = Dates::nowMillis();

            $id = (int) DB::table('qualityReviewConsultations')->insertGetId([
                'qualityReviewId' => (int) $review->id,
                'entityId' => $entityId,
                'audience' => Validate::enum($input['audience'] ?? null, self::AUDIENCES, 'audience'),
                'participantReference' => Validate::optionalString($input['participantReference'] ?? null, 'participantReference', 180),
                'invitedAt' => $now,
                'respondedAt' => $responseStatus === 'responded' ? $now : null,
                'method' => Validate::enum($input['method'] ?? null, self::METHODS, 'method'),
                'responseStatus' => $responseStatus,
                'accessibilityNeeds' => Validate::optionalString($input['accessibilityNeeds'] ?? null, 'accessibilityNeeds', 3000),
                'responseSummary' => Validate::optionalString($input['responseSummary'] ?? null, 'responseSummary', 6000),
                'noResponseReason' => Validate::optionalString($input['noResponseReason'] ?? null, 'noResponseReason', 3000),
                'recordedBy' => $ctx->userId(),
            ]);

            // The first consultation moves the review out of draft, so its stage
            // reflects the work rather than having to be set by hand.
            if ($review->status === 'draft') {
                DB::table('qualityReviews')->where('id', $review->id)->update(['status' => 'consultation']);
            }

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'propertyId' => $review->propertyId === null ? null : (int) $review->propertyId,
                'action' => 'quality_review.consultation_add',
                'resourceType' => 'quality_review_consultation',
                'resourceId' => $id,
                'sensitivity' => 'restricted',
                'result' => 'success',
                'metadata' => ['reviewId' => (int) $review->id, 'audience' => $input['audience'], 'responseStatus' => $responseStatus],
            ]);

            return ['id' => $id];
        });

        $registry->mutation('quality.addEvidence', Registry::USER, static function (Context $ctx, mixed $input): array {
            [$entityId, $review] = self::reviewForWrite($ctx, $input);
            self::assertAmendable($review);

            $documentId = Validate::optionalId($input['documentId'] ?? null, 'documentId');
            self::assertEvidenceDocumentScope($entityId, $review->propertyId === null ? null : (int) $review->propertyId, $documentId);

            $category = Validate::enum($input['category'] ?? null, self::EVIDENCE_CATEGORIES, 'category');
            $status = Validate::enum($input['status'] ?? 'identified', self::EVIDENCE_STATUSES, 'status');
            $now = Dates::nowMillis();

            $id = (int) DB::table('qualityReviewEvidence')->insertGetId([
                'qualityReviewId' => (int) $review->id,
                'entityId' => $entityId,
                'category' => $category,
                'title' => Validate::string($input['title'] ?? null, 'title', 3, 220),
                'documentId' => $documentId,
                'status' => $status,
                'analysis' => Validate::optionalString($input['analysis'] ?? null, 'analysis', 6000),
                'exclusionReason' => Validate::optionalString($input['exclusionReason'] ?? null, 'exclusionReason', 3000),
                'addedBy' => $ctx->userId(),
                // Adding something already marked reviewed records who said so.
                'reviewedAt' => $status === 'reviewed' ? $now : null,
                'reviewedBy' => $status === 'reviewed' ? $ctx->userId() : null,
            ]);

            if (in_array($review->status, ['draft', 'consultation'], true)) {
                DB::table('qualityReviews')->where('id', $review->id)->update(['status' => 'evidence_review']);
            }

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'propertyId' => $review->propertyId === null ? null : (int) $review->propertyId,
                'action' => 'quality_review.evidence_add',
                'resourceType' => 'quality_review_evidence',
                'resourceId' => $id,
                'sensitivity' => 'restricted',
                'result' => 'success',
                'metadata' => [
                    'reviewId' => (int) $review->id, 'category' => $category,
                    'status' => $status, 'hasDocument' => $documentId !== null,
                ],
            ]);

            return ['id' => $id];
        });

        $registry->mutation('quality.attachEvidenceFiles', Registry::USER, static function (Context $ctx, mixed $input): array {
            [$entityId, $review] = self::reviewForWrite($ctx, $input);
            self::assertAmendable($review);

            $evidenceId = Validate::id($input['evidenceId'] ?? null, 'evidenceId');
            $evidence = DB::table('qualityReviewEvidence')
                ->where('id', $evidenceId)
                ->where('qualityReviewId', $review->id)
                ->where('entityId', $entityId)
                ->first(['id', 'title', 'documentId']);

            if ($evidence === null) {
                throw TrpcException::notFound('Quality-review evidence item not found.');
            }

            // One bundle per evidence item, so the register says plainly which
            // files belong to which finding.
            if ($evidence->documentId !== null) {
                throw new TrpcException(
                    'PRECONDITION_FAILED',
                    'This evidence item already has a controlled file bundle. Add a separate evidence item for additional files.',
                );
            }

            $files = Validate::arrayOf($input['files'] ?? null, 'files', self::MAX_EVIDENCE_FILES);
            if ($files === []) {
                throw TrpcException::badRequest('Attach at least one evidence file.');
            }

            // Every file is decoded and checked before anything is written, so a
            // rejected fifth file does not leave four stored against a document
            // that is never completed.
            $materialised = [];
            foreach ($files as $index => $file) {
                $file = Validate::object($file, "files.$index");
                $mimeType = Validate::string($file['mimeType'] ?? null, "files.$index.mimeType", 3, 160);

                if (!in_array($mimeType, EvidenceStorage::ALLOWED_MIME_TYPES, true)) {
                    throw TrpcException::badRequest('Only approved image, PDF or Word evidence files can be attached.');
                }

                $bytes = base64_decode(Validate::string($file['base64'] ?? null, "files.$index.base64", 1, 14500000), true);
                if ($bytes === false || $bytes === '' || strlen($bytes) > self::MAX_EVIDENCE_BYTES) {
                    throw TrpcException::badRequest('Each evidence file must be between 1 byte and 10 MB.');
                }

                $materialised[] = [
                    'fileName' => Validate::string($file['fileName'] ?? null, "files.$index.fileName", 1, 300),
                    'mimeType' => $mimeType,
                    'bytes' => $bytes,
                ];
            }

            $documentId = (int) DB::table('documents')->insertGetId([
                'entityId' => $entityId,
                'propertyId' => $review->propertyId === null ? null : (int) $review->propertyId,
                'title' => $evidence->title,
                'documentType' => 'evidence',
                'classification' => 'restricted',
                'status' => 'in_review',
                'retentionBasis' => 'Quality review supporting evidence — retain under organisation retention schedule',
                'retentionUntil' => Dates::nowMillis() + QualityReviewRules::RETENTION_MS,
                'createdBy' => $ctx->userId(),
            ]);

            try {
                $versions = [];
                foreach ($materialised as $index => $file) {
                    $stored = EvidenceStorage::putBytes(
                        "entities/$entityId/quality-reviews/{$review->id}/evidence/$documentId",
                        $file['fileName'],
                        $file['mimeType'],
                        $file['bytes'],
                    );
                    $versions[] = [
                        'documentId' => $documentId,
                        'version' => $index + 1,
                        'fileKey' => $stored['key'],
                        'fileUrl' => $stored['url'],
                        'fileName' => $stored['fileName'],
                        'mimeType' => $file['mimeType'],
                        'sizeBytes' => $stored['sizeBytes'],
                        'contentHash' => $stored['contentHash'],
                        'scanStatus' => 'not_available',
                        'changeSummary' => 'Quality review evidence attachment',
                        'createdBy' => $ctx->userId(),
                    ];
                }

                DB::transaction(static function () use ($versions, $documentId, $evidence): void {
                    DB::table('documentVersions')->insert($versions);
                    DB::table('documents')->where('id', $documentId)->update(['currentVersion' => count($versions)]);
                    DB::table('qualityReviewEvidence')->where('id', $evidence->id)->update(['documentId' => $documentId]);
                });
            } catch (\Throwable $error) {
                // A half-written bundle is archived rather than left looking like
                // controlled evidence somebody can rely on.
                DB::table('documents')->where('id', $documentId)->update(['status' => 'archived']);

                throw $error;
            }

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'propertyId' => $review->propertyId === null ? null : (int) $review->propertyId,
                'action' => 'quality_review.evidence_upload',
                'resourceType' => 'quality_review_evidence',
                'resourceId' => (int) $evidence->id,
                'sensitivity' => 'restricted',
                'result' => 'success',
                'metadata' => [
                    'reviewId' => (int) $review->id,
                    'documentId' => $documentId,
                    'fileCount' => count($versions),
                    'contentHashes' => array_column($versions, 'contentHash'),
                ],
            ]);

            return ['documentId' => $documentId, 'fileCount' => count($versions)];
        });

        $registry->mutation('quality.completeReview', Registry::USER, static function (Context $ctx, mixed $input): array {
            [$entityId, $review] = self::reviewForWrite($ctx, $input);
            self::assertAmendable($review);

            $consultations = DB::table('qualityReviewConsultations')
                ->where('qualityReviewId', $review->id)->get()->map(static fn ($r) => (array) $r)->all();
            $evidence = DB::table('qualityReviewEvidence')
                ->where('qualityReviewId', $review->id)->get()->map(static fn ($r) => (array) $r)->all();

            $missing = QualityReviewRules::missingAudiences(array_map(
                static fn (array $row) => ['audience' => $row['audience'], 'responseStatus' => $row['responseStatus']],
                $consultations,
            ));
            if ($missing !== []) {
                throw TrpcException::badRequest('Consultation evidence is incomplete: ' . implode(', ', $missing));
            }

            // Collecting evidence is not the same as looking at it: a report
            // cannot be written from a pile nobody has read.
            $reviewed = array_filter($evidence, static fn (array $row) => $row['status'] === 'reviewed');
            if ($reviewed === []) {
                throw TrpcException::badRequest('At least one evidence item must be reviewed before creating the report draft.');
            }

            $narrative = [];
            foreach (self::REPORT_FIELDS as $field => $minimum) {
                $narrative[$field] = Validate::string($input[$field] ?? null, $field, $minimum, 8000);
            }

            $completedAt = Dates::nowMillis();

            DB::table('qualityReviews')->where('id', $review->id)->update($narrative + [
                'status' => 'report_draft',
                'completedAt' => $completedAt,
                'completedBy' => $ctx->userId(),
                // A re-draft clears any earlier approval: what was approved is
                // no longer what the report says.
                'approvedAt' => null,
                'approvedBy' => null,
            ]);

            $context = self::reportContext($review);
            $actorName = (string) ($ctx->requireUser()['name'] ?? '') ?: 'Authorised user';

            $bytes = QualityReviewPdf::render(self::pdfInput(
                $review, $narrative, $context, $completedAt, $actorName, null,
            ));

            $fileName = QualityReviewRules::pdfFileName((int) $review->id, 'draft', $completedAt);
            $stored = EvidenceStorage::putBytes(
                "entities/$entityId/quality-reviews/{$review->id}",
                "draft-$fileName",
                'application/pdf',
                $bytes,
            );

            $documentId = (int) DB::table('documents')->insertGetId([
                'entityId' => $entityId,
                'propertyId' => $review->propertyId === null ? null : (int) $review->propertyId,
                'title' => QualityReviewRules::documentTitle((string) $review->title, (int) $review->id),
                'documentType' => 'generated',
                'classification' => 'restricted',
                'status' => 'in_review',
                'retentionBasis' => QualityReviewRules::RETENTION_BASIS,
                'retentionUntil' => $completedAt + QualityReviewRules::RETENTION_MS,
                'createdBy' => $ctx->userId(),
            ]);

            DB::table('documentVersions')->insert([
                'documentId' => $documentId,
                'version' => 1,
                'fileKey' => $stored['key'],
                'fileUrl' => $stored['url'],
                'fileName' => $fileName,
                'mimeType' => 'application/pdf',
                'sizeBytes' => $stored['sizeBytes'],
                'contentHash' => $stored['contentHash'],
                'scanStatus' => 'not_available',
                'changeSummary' => 'Editable quality review draft snapshot prepared for independent approval',
                'createdBy' => $ctx->userId(),
            ]);

            // An earlier draft is superseded rather than deleted: it is what an
            // earlier reader saw.
            if ($review->reportDocumentId !== null) {
                DB::table('documents')->where('id', $review->reportDocumentId)->update(['status' => 'superseded']);
            }

            DB::table('qualityReviews')->where('id', $review->id)->update(['reportDocumentId' => $documentId]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'propertyId' => $review->propertyId === null ? null : (int) $review->propertyId,
                'action' => 'quality_review.report_draft',
                'resourceType' => 'quality_review',
                'resourceId' => (int) $review->id,
                'sensitivity' => 'restricted',
                'result' => 'success',
                'metadata' => QualityReviewRules::auditMetadata(
                    'draft', $documentId, 1, count($context['evidence']), count($context['consultations']),
                ),
            ]);

            return ['success' => true, 'reportDocumentId' => $documentId];
        });

        $registry->mutation('quality.previewReport', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $access = self::assertQualityAccess($ctx, $entityId, 'compliance.read');

            $reviewId = Validate::id($input['reviewId'] ?? null, 'reviewId');
            $review = DB::table('qualityReviews')->where('id', $reviewId)->where('entityId', $entityId)->first();

            if ($review === null
                || $review->reportDocumentId === null
                || !in_array($review->status, ['report_draft', 'approved', 'submitted'], true)) {
                throw new TrpcException('PRECONDITION_FAILED', 'A printable quality review report has not been prepared yet.');
            }

            if ($review->propertyId !== null && $access['role'] !== 'platform_admin') {
                Authz::assertPropertyCapability($ctx->userId(), $entityId, (int) $review->propertyId, 'compliance.read');
            }

            // Version 1 is the draft; version 2 is the approved copy with its
            // certificate. Which one is shown follows the review's own state.
            $isDraft = $review->status === 'report_draft';
            $version = DB::table('documentVersions')
                ->where('documentId', $review->reportDocumentId)
                ->where('version', $isDraft ? 1 : 2)
                ->first();

            if ($version === null || $version->fileKey === null) {
                throw TrpcException::notFound('The controlled quality-review PDF is unavailable.');
            }

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'propertyId' => $review->propertyId === null ? null : (int) $review->propertyId,
                'action' => 'quality_review.report_preview',
                'resourceType' => 'quality_review',
                'resourceId' => (int) $review->id,
                'sensitivity' => 'restricted',
                'result' => 'allowed',
                'metadata' => QualityReviewRules::auditMetadata(
                    $isDraft ? 'draft' : 'approved',
                    (int) $review->reportDocumentId,
                    (int) $version->version,
                    DB::table('qualityReviewEvidence')->where('qualityReviewId', $review->id)->count(),
                    DB::table('qualityReviewConsultations')->where('qualityReviewId', $review->id)->count(),
                ),
            ]);

            return [
                'url' => $version->fileUrl,
                'fileName' => $version->fileName
                    ?? QualityReviewRules::pdfFileName((int) $review->id, $isDraft ? 'draft' : 'approved', Dates::nowMillis()),
                'status' => $review->status,
            ];
        });

        $registry->mutation('quality.approveReview', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $access = self::assertQualityAccess($ctx, $entityId, 'compliance.write');

            if (!QualityReviewRules::isReportManager($access['role'])) {
                throw TrpcException::forbidden(
                    'Only an Owner, RSM, Manager or Nominated Individual can independently approve a quality review.',
                );
            }

            [, $review] = self::reviewForWrite($ctx, $input);

            QualityReviewRules::assertIndependentApproval(
                (string) $review->status,
                $ctx->userId(),
                $review->createdBy === null ? null : (int) $review->createdBy,
                $review->completedBy === null ? null : (int) $review->completedBy,
                $review->reportDocumentId === null ? null : (int) $review->reportDocumentId,
            );

            $draft = DB::table('documentVersions')
                ->where('documentId', $review->reportDocumentId)->where('version', 1)->first();

            if ($draft === null || $draft->fileKey === null) {
                throw TrpcException::notFound('The reviewed quality-report draft is unavailable.');
            }

            // The approver signs what they read. A consultation or evidence row
            // touched since the draft was written means they would be signing
            // something else, so the draft has to be made again.
            if (self::changedSinceDraft((int) $review->id, (string) $draft->createdAt)) {
                throw new TrpcException(
                    'PRECONDITION_FAILED',
                    'The consultation or evidence record has changed since this draft was prepared. Create the report draft again before approving.',
                );
            }

            $approvedAt = Dates::nowMillis();
            $context = self::reportContext($review);

            $narrative = [];
            foreach (array_keys(self::REPORT_FIELDS) as $field) {
                $narrative[$field] = (string) ($review->$field ?? '');
            }

            $completedBy = $review->completedBy === null ? null : Users::byId((int) $review->completedBy);

            $bytes = QualityReviewPdf::render(self::pdfInput(
                $review,
                $narrative,
                $context,
                $review->completedAt === null ? $approvedAt : (int) $review->completedAt,
                (string) ($completedBy['name'] ?? '') ?: 'Authorised user',
                [
                    'approverName' => (string) ($ctx->requireUser()['name'] ?? '') ?: 'Authorised reviewer',
                    'approverRole' => $access['role'],
                    'approvedAt' => $approvedAt,
                ],
            ));

            $fileName = QualityReviewRules::pdfFileName((int) $review->id, 'approved', $approvedAt);
            $stored = EvidenceStorage::putBytes(
                "entities/$entityId/quality-reviews/{$review->id}",
                "approved-$fileName",
                'application/pdf',
                $bytes,
            );

            DB::transaction(static function () use ($ctx, $review, $stored, $fileName, $approvedAt): void {
                DB::table('documentVersions')->insert([
                    'documentId' => (int) $review->reportDocumentId,
                    'version' => 2,
                    'fileKey' => $stored['key'],
                    'fileUrl' => $stored['url'],
                    'fileName' => $fileName,
                    'mimeType' => 'application/pdf',
                    'sizeBytes' => $stored['sizeBytes'],
                    'contentHash' => $stored['contentHash'],
                    'scanStatus' => 'not_available',
                    'changeSummary' => 'Independent quality-review approval certificate appended',
                    'approvedAt' => $approvedAt,
                    'approvedBy' => $ctx->userId(),
                    'createdBy' => $ctx->userId(),
                ]);

                DB::table('documents')->where('id', $review->reportDocumentId)
                    ->update(['status' => 'approved', 'currentVersion' => 2]);

                DB::table('qualityReviews')->where('id', $review->id)
                    ->update(['status' => 'approved', 'approvedAt' => $approvedAt, 'approvedBy' => $ctx->userId()]);
            });

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'propertyId' => $review->propertyId === null ? null : (int) $review->propertyId,
                'action' => 'quality_review.approved',
                'resourceType' => 'quality_review',
                'resourceId' => (int) $review->id,
                'sensitivity' => 'restricted',
                'result' => 'success',
                'metadata' => QualityReviewRules::auditMetadata(
                    'approved', (int) $review->reportDocumentId, 2,
                    count($context['evidence']), count($context['consultations']),
                ),
            ]);

            return ['success' => true, 'reportDocumentId' => (int) $review->reportDocumentId];
        });

        $registry->mutation('quality.submitReview', Registry::USER, static function (Context $ctx, mixed $input): array {
            [$entityId, $review] = self::reviewForWrite($ctx, $input);

            if ($review->status !== 'approved') {
                throw TrpcException::badRequest('Only an approved review can be recorded as submitted.');
            }

            $evidenceDocumentId = Validate::optionalId($input['submissionEvidenceDocumentId'] ?? null, 'submissionEvidenceDocumentId');
            self::assertEvidenceDocumentScope(
                $entityId,
                $review->propertyId === null ? null : (int) $review->propertyId,
                $evidenceDocumentId,
            );

            $submissionMethod = Validate::enum($input['submissionMethod'] ?? null, self::SUBMISSION_METHODS, 'submissionMethod');

            DB::table('qualityReviews')->where('id', $review->id)->update([
                'status' => 'submitted',
                'submittedAt' => Dates::nowMillis(),
                'submittedBy' => $ctx->userId(),
                'submissionMethod' => $submissionMethod,
                'submissionReference' => Validate::optionalString($input['submissionReference'] ?? null, 'submissionReference', 180),
                'submissionEvidenceDocumentId' => $evidenceDocumentId,
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'propertyId' => $review->propertyId === null ? null : (int) $review->propertyId,
                'action' => 'quality_review.submitted',
                'resourceType' => 'quality_review',
                'resourceId' => (int) $review->id,
                'sensitivity' => 'restricted',
                'result' => 'success',
                'metadata' => [
                    'submissionMethod' => $submissionMethod,
                    'hasSubmissionEvidence' => $evidenceDocumentId !== null,
                ],
            ]);

            return ['success' => true];
        });
    }

    /**
     * Quality reviews are narrower than the compliance capability alone: they
     * are the provider's own judgement about its care, so a finance or
     * document-only user with compliance.read does not see them.
     *
     * A platform administrator may read but never write: they are there to
     * support the service, not to author its regulatory judgement.
     *
     * @return array<string, mixed>
     */
    private static function assertQualityAccess(Context $ctx, int $entityId, string $capability): array
    {
        $user = $ctx->requireUser();

        if (($user['operationalRole'] ?? null) === 'platform_admin') {
            $member = DB::table('entityMemberships')
                ->where('entityId', $entityId)->where('userId', $ctx->userId())->first('id');

            if ($member !== null) {
                if ($capability === 'compliance.write') {
                    throw self::accessError();
                }

                return ['role' => 'platform_admin', 'allProperties' => true];
            }
        }

        $access = Authz::assertEntityCapability($ctx->userId(), $entityId, $capability);

        if (!in_array($access['role'], ['owner', 'registered_manager', 'hr_compliance'], true)) {
            throw self::accessError();
        }

        return $access;
    }

    private static function accessError(): TrpcException
    {
        return TrpcException::forbidden(
            'Quality reviews are available only to authorised Managers, RSMs, Owners, Nominated Individuals and compliance users.'
        );
    }

    /**
     * The write gate: quality access, then the review, then the property it
     * belongs to.
     *
     * @return array{0: int, 1: object}
     */
    private static function reviewForWrite(Context $ctx, mixed $input): array
    {
        $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
        self::assertQualityAccess($ctx, $entityId, 'compliance.write');

        $reviewId = Validate::id($input['reviewId'] ?? null, 'reviewId');
        $review = DB::table('qualityReviews')->where('id', $reviewId)->where('entityId', $entityId)->first();

        if ($review === null) {
            throw TrpcException::notFound('Quality review not found.');
        }

        if ($review->propertyId !== null) {
            Authz::assertPropertyCapability($ctx->userId(), $entityId, (int) $review->propertyId, 'compliance.write');
        }

        return [$entityId, $review];
    }

    private static function assertAmendable(object $review): void
    {
        if (in_array($review->status, QualityReviewRules::CONTROLLED_STATUSES, true)) {
            throw new TrpcException('PRECONDITION_FAILED', 'This quality review is controlled and cannot be amended.');
        }
    }

    /**
     * A document named as evidence has to be this company's, and where the
     * review is about one property it cannot reach into another.
     */
    private static function assertEvidenceDocumentScope(int $entityId, ?int $propertyId, ?int $documentId): void
    {
        if ($documentId === null) {
            return;
        }

        $document = DB::table('documents')->where('id', $documentId)->where('entityId', $entityId)->first('propertyId');

        if ($document === null
            || ($propertyId !== null && $document->propertyId !== null && (int) $document->propertyId !== $propertyId)) {
            throw TrpcException::forbidden(
                'The selected evidence document is outside this review’s authorised entity or premise scope.'
            );
        }
    }

    /**
     * Has anything behind the report moved since the draft was written?
     *
     * updatedAt covers an edit as well as an addition, and both matter: the
     * certificate says the approver read this report.
     */
    private static function changedSinceDraft(int $reviewId, string $draftCreatedAt): bool
    {
        foreach (['qualityReviewConsultations', 'qualityReviewEvidence'] as $table) {
            $changed = DB::table($table)
                ->where('qualityReviewId', $reviewId)
                ->where('updatedAt', '>', $draftCreatedAt)
                ->exists();

            if ($changed) {
                return true;
            }
        }

        return false;
    }

    /**
     * The company and property names, plus everything attached to the review.
     *
     * @return array{entityName: string, propertyName: ?string, consultations: array<int, array<string, mixed>>, evidence: array<int, array<string, mixed>>}
     */
    private static function reportContext(object $review): array
    {
        $entity = DB::table('entities')->where('id', $review->entityId)->first('name');
        if ($entity === null) {
            throw TrpcException::notFound('Entity not found.');
        }

        $property = $review->propertyId === null ? null : DB::table('properties')
            ->where('id', $review->propertyId)->where('entityId', $review->entityId)->first('name');

        return [
            'entityName' => (string) $entity->name,
            'propertyName' => $property === null ? null : (string) $property->name,
            'consultations' => DB::table('qualityReviewConsultations')
                ->where('qualityReviewId', $review->id)->get()->map(static fn ($r) => (array) $r)->all(),
            'evidence' => DB::table('qualityReviewEvidence')
                ->where('qualityReviewId', $review->id)->get()->map(static fn ($r) => (array) $r)->all(),
        ];
    }

    /**
     * @param array<string, string> $narrative
     * @param array<string, mixed> $context
     * @param array<string, mixed>|null $approval
     * @return array<string, mixed>
     */
    private static function pdfInput(
        object $review,
        array $narrative,
        array $context,
        int $generatedAt,
        string $generatedBy,
        ?array $approval,
    ): array {
        return $narrative + [
            'entityName' => $context['entityName'],
            'propertyName' => $context['propertyName'],
            'title' => (string) $review->title,
            'reviewId' => (int) $review->id,
            'periodStart' => (int) $review->periodStart,
            'periodEnd' => (int) $review->periodEnd,
            'generatedAt' => $generatedAt,
            'generatedBy' => $generatedBy,
            'evidence' => array_map(static fn (array $item) => [
                'category' => $item['category'],
                'title' => $item['title'],
                'status' => $item['status'],
                'analysis' => $item['analysis'],
                'documentAttached' => $item['documentId'] !== null,
            ], $context['evidence']),
            'consultations' => array_map(static fn (array $item) => [
                'audience' => $item['audience'],
                'method' => $item['method'],
                'responseStatus' => $item['responseStatus'],
                // A non-response is explained by its reason rather than by an
                // empty summary.
                'summary' => $item['responseStatus'] === 'no_response'
                    ? $item['noResponseReason']
                    : $item['responseSummary'],
            ], $context['consultations']),
            'approval' => $approval,
        ];
    }
}
