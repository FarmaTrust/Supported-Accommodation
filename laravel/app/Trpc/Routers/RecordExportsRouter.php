<?php

declare(strict_types=1);

namespace App\Trpc\Routers;

use App\Support\Audit;
use App\Support\Authz;
use App\Support\Crypto;
use App\Support\Dates;
use App\Support\EvidenceStorage;
use App\Support\PrintableExportRules;
use App\Support\PrintableSnapshots;
use App\Support\RecordExportPdf;
use App\Trpc\Context;
use App\Trpc\Registry;
use App\Trpc\TrpcException;
use App\Trpc\Validate;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * recordExports.*, mirroring server/routers/recordExports.ts.
 *
 * Printable records: a PDF of what the system holds, made to leave the system.
 * Every one is rendered from a snapshot and stamped with that snapshot's
 * SHA-256, so a printed copy can be checked back against the records it came
 * from. A young-person compilation is the one kind that needs a second, named
 * person to release it — it is a paper record of a child's life, and once it
 * is printed the system has no further control over where it goes.
 */
final class RecordExportsRouter
{
    public static function register(Registry $registry): void
    {
        self::registerRequests($registry);
        self::registerLists($registry);
        self::registerRelease($registry);
    }

    // ------------------------------------------------------------ requests

    private static function registerRequests(Registry $registry): void
    {
        $registry->mutation('recordExports.requestYoungPersonCompilation', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $placementId = Validate::id($input['placementId'] ?? null, 'placementId');
            $rangeStart = Validate::int($input['rangeStart'] ?? null, 'rangeStart', 1);
            $rangeEnd = Validate::int($input['rangeEnd'] ?? null, 'rangeEnd', 1);

            PrintableExportRules::assertRange($rangeStart, $rangeEnd);

            $scope = Authz::assertCurrentShiftPlacementCapability($ctx->userId(), $placementId, 'young_person.read');
            if ((int) $scope['placement']['entityId'] !== $entityId) {
                throw TrpcException::forbidden('Placement access denied.');
            }

            $snapshot = PrintableSnapshots::youngPerson(
                $entityId, $placementId, $rangeStart, $rangeEnd, self::entityName($entityId),
            );

            return self::createExport([
                'entityId' => $entityId,
                'propertyId' => $scope['placement']['propertyId'] === null ? null : (int) $scope['placement']['propertyId'],
                'placementId' => $placementId,
                'requesterId' => $ctx->userId(),
                'requesterName' => self::requesterName($ctx),
                'rangeStart' => $rangeStart,
                'rangeEnd' => $rangeEnd,
                'snapshot' => $snapshot,
            ]);
        });

        $registry->mutation('recordExports.requestShiftRegister', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyId = Validate::optionalId($input['propertyId'] ?? null, 'propertyId');
            $rangeStart = Validate::int($input['rangeStart'] ?? null, 'rangeStart', 1);
            $rangeEnd = Validate::int($input['rangeEnd'] ?? null, 'rangeEnd', 1);

            PrintableExportRules::assertRange($rangeStart, $rangeEnd);
            $scope = self::assertShiftExportScope($ctx->userId(), $entityId, $propertyId);

            $snapshot = PrintableSnapshots::shiftRegister(
                $entityId,
                $scope['propertyIds'],
                self::propertyName($entityId, $propertyId) ?? 'All authorised properties',
                $rangeStart,
                $rangeEnd,
                self::entityName($entityId),
                PrintableExportRules::isManagerRole($scope['role']),
            );

            return self::createExport([
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'requesterId' => $ctx->userId(),
                'requesterName' => self::requesterName($ctx),
                'rangeStart' => $rangeStart,
                'rangeEnd' => $rangeEnd,
                'snapshot' => $snapshot,
            ]);
        });

        $registry->mutation('recordExports.requestDocumentRegister', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyId = Validate::optionalId($input['propertyId'] ?? null, 'propertyId');
            $rangeStart = Validate::int($input['rangeStart'] ?? null, 'rangeStart', 1);
            $rangeEnd = Validate::int($input['rangeEnd'] ?? null, 'rangeEnd', 1);

            PrintableExportRules::assertRange($rangeStart, $rangeEnd);
            $scope = self::assertDocumentExportScope($ctx->userId(), $entityId, $propertyId);

            $snapshot = PrintableSnapshots::documentRegister(
                $entityId,
                $scope['propertyIds'],
                self::propertyName($entityId, $propertyId) ?? 'All authorised properties',
                $rangeStart,
                $rangeEnd,
                self::entityName($entityId),
            );

            return self::createExport([
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'requesterId' => $ctx->userId(),
                'requesterName' => self::requesterName($ctx),
                'rangeStart' => $rangeStart,
                'rangeEnd' => $rangeEnd,
                'snapshot' => $snapshot,
            ]);
        });

        $registry->mutation('recordExports.requestTimesheet', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $timesheetId = Validate::id($input['timesheetId'] ?? null, 'timesheetId');

            $sheet = DB::table('timesheets')->where('id', $timesheetId)->where('entityId', $entityId)->first();
            if ($sheet === null) {
                throw TrpcException::notFound('Timesheet not found.');
            }

            $access = Authz::assertEntityCapability($ctx->userId(), $entityId, 'shift.read');
            if (!PrintableExportRules::isShiftExportRole($access['role']) && (int) $sheet->userId !== $ctx->userId()) {
                throw TrpcException::forbidden('You are not authorised to export this timesheet.');
            }

            // Only a timesheet somebody else already approved becomes a paper
            // record; a draft is still being argued about.
            if (!in_array($sheet->status, ['approved', 'exported'], true)) {
                throw new TrpcException('PRECONDITION_FAILED', 'Only an independently approved timesheet can be exported as a printable record.');
            }

            $worker = DB::table('users')->where('id', (int) $sheet->userId)->first('name');

            $snapshot = PrintableSnapshots::timesheet(
                (int) $sheet->id,
                self::entityName($entityId),
                $worker->name ?? 'Worker',
                $sheet->approvedAt === null ? null : (int) $sheet->approvedAt,
            );

            return self::createExport([
                'entityId' => $entityId,
                'timesheetId' => (int) $sheet->id,
                'requesterId' => $ctx->userId(),
                'requesterName' => self::requesterName($ctx),
                'rangeStart' => (int) $sheet->periodStart,
                'rangeEnd' => (int) $sheet->periodEnd,
                'snapshot' => $snapshot,
            ]);
        });
    }

    // --------------------------------------------------------------- lists

    private static function registerLists(Registry $registry): void
    {
        $registry->query('recordExports.placementExports', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $placementId = Validate::id($input['placementId'] ?? null, 'placementId');

            $scope = Authz::assertCurrentShiftPlacementCapability($ctx->userId(), $placementId, 'young_person.read');
            if ((int) $scope['placement']['entityId'] !== $entityId) {
                throw TrpcException::forbidden('Placement access denied.');
            }

            return self::summaries(self::listQuery($entityId)->where('e.placementId', $placementId));
        });

        $registry->query('recordExports.shiftExports', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyId = Validate::optionalId($input['propertyId'] ?? null, 'propertyId');

            self::assertShiftExportScope($ctx->userId(), $entityId, $propertyId);

            $query = self::listQuery($entityId)->where('e.exportType', 'shift_register');
            if ($propertyId !== null) {
                $query->where('e.propertyId', $propertyId);
            }

            return self::summaries($query);
        });

        $registry->query('recordExports.documentExports', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyId = Validate::optionalId($input['propertyId'] ?? null, 'propertyId');

            self::assertDocumentExportScope($ctx->userId(), $entityId, $propertyId);

            $query = self::listQuery($entityId)->where('e.exportType', 'document_register');
            if ($propertyId !== null) {
                $query->where('e.propertyId', $propertyId);
            }

            return self::summaries($query);
        });

        $registry->query('recordExports.approvalQueue', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            self::assertManagerApprovalRole($ctx->userId(), $entityId);

            $rows = DB::table('printableRecordExports as e')
                ->join('users as u', 'u.id', '=', 'e.requestedBy')
                ->leftJoin('properties as p', 'p.id', '=', 'e.propertyId')
                ->where('e.entityId', $entityId)
                ->where('e.exportType', 'young_person_compilation')
                ->whereIn('e.status', ['awaiting_approval', 'failed'])
                ->orderByDesc('e.createdAt')
                ->get(['e.*', 'u.name as requestedByName', 'p.name as propertyName'])->all();

            return array_map(
                static fn ($row) => self::summary($row, $row->requestedByName) + ['propertyName' => $row->propertyName],
                $rows,
            );
        });
    }

    // ------------------------------------------------------------- release

    private static function registerRelease(Registry $registry): void
    {
        $registry->mutation('recordExports.preview', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $id = Validate::id($input['id'] ?? null, 'id');

            self::assertManagerApprovalRole($ctx->userId(), $entityId);
            $row = self::loadExport($entityId, $id);

            if ($row->exportType !== 'young_person_compilation' || $row->documentId === null
                || !in_array($row->status, ['awaiting_approval', 'failed'], true)
            ) {
                throw new TrpcException('PRECONDITION_FAILED', 'A staged young-person record PDF is not available for review.');
            }

            $version = DB::table('documentVersions')
                ->where('documentId', (int) $row->documentId)->where('version', 1)->first();

            if ($version === null || $version->fileKey === null) {
                throw TrpcException::notFound('The staged PDF is unavailable.');
            }

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => $entityId,
                'propertyId' => $row->propertyId === null ? null : (int) $row->propertyId,
                'action' => 'printable_record_export.preview', 'resourceType' => 'printable_record_export',
                'resourceId' => (int) $row->id, 'sensitivity' => 'safeguarding', 'result' => 'allowed',
                'metadata' => PrintableExportRules::auditMetadata(
                    $row->exportType, self::recordCount($row), (int) $row->documentId,
                ),
            ]);

            return ['url' => $version->fileUrl, 'fileName' => $version->fileName ?? 'staged-record.pdf'];
        });

        $registry->mutation('recordExports.review', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $id = Validate::id($input['id'] ?? null, 'id');
            $decision = Validate::enum($input['decision'] ?? null, PrintableExportRules::DECISIONS, 'decision');
            $notes = Validate::optionalString($input['notes'] ?? null, 'notes', 4000);
            $notes = $notes === null ? null : trim($notes);

            $access = self::assertManagerApprovalRole($ctx->userId(), $entityId);
            $row = self::loadExport($entityId, $id);

            if ($row->exportType !== 'young_person_compilation') {
                throw TrpcException::badRequest('Only young-person record compilations use this approval workflow.');
            }

            PrintableExportRules::assertIndependentReview(
                (string) $row->status, (int) $row->requestedBy, $ctx->userId(), $decision, $notes,
            );

            $reviewedAt = Dates::nowMillis();
            $recordCount = self::recordCount($row);

            if ($decision !== 'approved') {
                DB::table('printableRecordExports')->where('id', (int) $row->id)->update([
                    'status' => $decision,
                    'reviewedBy' => $ctx->userId(),
                    'reviewerRole' => $access['role'],
                    'reviewedAt' => $reviewedAt,
                    'reviewNotesCiphertext' => $notes === null ? null : Crypto::encrypt($notes),
                ]);

                Audit::write([
                    'actorUserId' => $ctx->userId(), 'entityId' => $entityId,
                    'propertyId' => $row->propertyId === null ? null : (int) $row->propertyId,
                    'action' => "printable_record_export.$decision", 'resourceType' => 'printable_record_export',
                    'resourceId' => (int) $row->id, 'sensitivity' => 'safeguarding', 'result' => 'success',
                    'metadata' => PrintableExportRules::auditMetadata(
                        $row->exportType, $recordCount,
                        $row->documentId === null ? null : (int) $row->documentId,
                    ),
                ]);

                return ['id' => (int) $row->id, 'status' => $decision];
            }

            if ($row->documentId === null) {
                throw new TrpcException('PRECONDITION_FAILED', 'The staged PDF is unavailable for approval.');
            }

            try {
                $approved = self::renderApprovedRecord($ctx, $entityId, $row, $access['role'], $reviewedAt);
                $fileName = PrintableExportRules::fileName($row->exportType, (int) $row->id, $reviewedAt);

                $stored = EvidenceStorage::putBytes(
                    "entities/$entityId/printable-record-exports/{$row->id}/approved",
                    $fileName,
                    'application/pdf',
                    $approved,
                );

                DB::transaction(static function () use ($row, $stored, $fileName, $approved, $reviewedAt, $access, $notes, $ctx): void {
                    DB::table('documentVersions')->insert([
                        'documentId' => (int) $row->documentId,
                        'version' => 2,
                        'fileKey' => $stored['key'],
                        'fileUrl' => $stored['url'],
                        'fileName' => $fileName,
                        'mimeType' => 'application/pdf',
                        'sizeBytes' => strlen($approved),
                        'contentHash' => hash('sha256', $approved),
                        'scanStatus' => 'not_available',
                        'changeSummary' => 'Independent approval certificate appended to immutable staged record snapshot',
                        'approvedAt' => $reviewedAt,
                        'approvedBy' => $ctx->userId(),
                        'createdBy' => $ctx->userId(),
                    ]);

                    DB::table('documents')->where('id', (int) $row->documentId)
                        ->update(['status' => 'approved', 'currentVersion' => 2]);

                    DB::table('printableRecordExports')->where('id', (int) $row->id)->update([
                        'status' => 'ready',
                        'reviewedBy' => $ctx->userId(),
                        'reviewerRole' => $access['role'],
                        'reviewedAt' => $reviewedAt,
                        'reviewNotesCiphertext' => $notes === null ? null : Crypto::encrypt($notes),
                        'releasedAt' => $reviewedAt,
                        'errorCode' => null,
                    ]);
                });

                Audit::write([
                    'actorUserId' => $ctx->userId(), 'entityId' => $entityId,
                    'propertyId' => $row->propertyId === null ? null : (int) $row->propertyId,
                    'action' => 'printable_record_export.approved', 'resourceType' => 'printable_record_export',
                    'resourceId' => (int) $row->id, 'sensitivity' => 'safeguarding', 'result' => 'success',
                    'metadata' => PrintableExportRules::auditMetadata($row->exportType, $recordCount, (int) $row->documentId),
                ]);

                return ['id' => (int) $row->id, 'status' => 'ready'];
            } catch (Throwable $error) {
                $errorCode = PrintableExportRules::failureCode();

                DB::table('printableRecordExports')->where('id', (int) $row->id)->update([
                    'status' => 'failed',
                    'reviewedBy' => $ctx->userId(),
                    'reviewerRole' => $access['role'],
                    'reviewedAt' => $reviewedAt,
                    'errorCode' => $errorCode,
                ]);

                Audit::write([
                    'actorUserId' => $ctx->userId(), 'entityId' => $entityId,
                    'propertyId' => $row->propertyId === null ? null : (int) $row->propertyId,
                    'action' => 'printable_record_export.approval_generate', 'resourceType' => 'printable_record_export',
                    'resourceId' => (int) $row->id, 'sensitivity' => 'safeguarding', 'result' => 'failure',
                    'reasonCode' => $errorCode,
                    'metadata' => PrintableExportRules::auditMetadata($row->exportType, $recordCount, (int) $row->documentId),
                ]);

                throw new TrpcException(
                    'INTERNAL_SERVER_ERROR',
                    'The approved PDF could not be generated. The staged request is retained for controlled review and retry.',
                );
            }
        });

        $registry->mutation('recordExports.download', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $id = Validate::id($input['id'] ?? null, 'id');

            $row = self::loadExport($entityId, $id);
            self::assertExportReadScope($ctx->userId(), $row);

            if ($row->status !== 'ready' || $row->documentId === null) {
                throw new TrpcException('PRECONDITION_FAILED', 'This printable record is not approved and ready for controlled download.');
            }

            $version = DB::table('documentVersions')
                ->where('documentId', (int) $row->documentId)
                ->where('version', $row->exportType === 'young_person_compilation' ? 2 : 1)
                ->first();

            if ($version === null || $version->fileKey === null) {
                throw TrpcException::notFound('The approved PDF is unavailable.');
            }

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => $entityId,
                'propertyId' => $row->propertyId === null ? null : (int) $row->propertyId,
                'action' => 'printable_record_export.download', 'resourceType' => 'printable_record_export',
                'resourceId' => (int) $row->id,
                'sensitivity' => PrintableExportRules::classification($row->exportType), 'result' => 'allowed',
                'metadata' => PrintableExportRules::auditMetadata(
                    $row->exportType, self::recordCount($row), (int) $row->documentId,
                ),
            ]);

            return [
                'url' => $version->fileUrl,
                'fileName' => $version->fileName
                    ?? PrintableExportRules::fileName($row->exportType, (int) $row->id, Dates::nowMillis()),
            ];
        });
    }

    // -------------------------------------------------------------- shared

    /**
     * Rebuilds the snapshot the request was raised from and refuses to release
     * it if the records no longer hash to what was staged.
     *
     * ponytail: Node loads the staged PDF and appends a page to it. FPDF cannot
     * import an existing PDF, so the record is re-rendered from the source
     * instead. The hash check makes that stricter rather than weaker — a
     * record altered since staging now fails approval, where appending would
     * have released a certificate over stale bytes. Add setasign/fpdi if the
     * staged bytes themselves ever need to be the released artefact.
     */
    private static function renderApprovedRecord(Context $ctx, int $entityId, object $row, string $role, int $reviewedAt): string
    {
        $snapshot = PrintableSnapshots::youngPerson(
            $entityId,
            (int) $row->placementId,
            (int) $row->rangeStart,
            (int) $row->rangeEnd,
            self::entityName($entityId),
        );

        if (PrintableSnapshots::hash($snapshot) !== $row->snapshotHash) {
            throw new TrpcException(
                'PRECONDITION_FAILED',
                'The underlying records changed after this export was staged. Request a fresh export so the approval covers what it names.',
            );
        }

        return RecordExportPdf::render([
            'title' => PrintableExportRules::title($row->exportType),
            'entityName' => $snapshot['entityName'],
            'propertyName' => $snapshot['propertyName'],
            'placementReference' => $snapshot['placementReference'],
            'preferredName' => $snapshot['preferredName'],
            'rangeStart' => (int) $row->rangeStart,
            'rangeEnd' => (int) $row->rangeEnd,
            'generatedAt' => $reviewedAt,
            'snapshotHash' => (string) $row->snapshotHash,
            'requestedByName' => self::userName((int) $row->requestedBy),
            'approval' => [
                'approverName' => self::requesterName($ctx),
                'approverRole' => $role,
                'approvedAt' => $reviewedAt,
                'exportId' => (int) $row->id,
            ],
            'sections' => $snapshot['sections'],
        ]);
    }

    /**
     * @param array{entityId: int, propertyId?: int|null, placementId?: int|null, timesheetId?: int|null, requesterId: int, requesterName: string, rangeStart: int, rangeEnd: int, snapshot: array<string, mixed>} $input
     * @return array{id: int, status: string}
     */
    private static function createExport(array $input): array
    {
        $snapshot = $input['snapshot'];
        $type = (string) $snapshot['type'];
        $createdAt = Dates::nowMillis();
        $hash = PrintableSnapshots::hash($snapshot);
        $requiresApproval = PrintableExportRules::requiresIndependentApproval($type);

        $manifest = [
            'schemaVersion' => 1,
            'generatedAt' => $createdAt,
            'entityId' => $input['entityId'],
            'propertyId' => $input['propertyId'] ?? null,
            'placementId' => $input['placementId'] ?? null,
            'timesheetId' => $input['timesheetId'] ?? null,
            'exportType' => $type,
            'sourceCounts' => $snapshot['sourceCounts'],
            'recordCount' => $snapshot['recordCount'],
            'dateRange' => ['start' => $input['rangeStart'], 'end' => $input['rangeEnd']],
            'renderer' => 'record_export_pdf_v1',
        ];

        $requestId = (int) DB::table('printableRecordExports')->insertGetId([
            'entityId' => $input['entityId'],
            'propertyId' => $input['propertyId'] ?? null,
            'placementId' => $input['placementId'] ?? null,
            'timesheetId' => $input['timesheetId'] ?? null,
            'exportType' => $type,
            'rangeStart' => $input['rangeStart'],
            'rangeEnd' => $input['rangeEnd'],
            'status' => $requiresApproval ? 'awaiting_approval' : 'generating',
            'snapshotHash' => $hash,
            'manifest' => json_encode($manifest, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            'requestedBy' => $input['requesterId'],
        ]);

        try {
            $archive = self::archiveStagedSnapshot($input, $requestId, $hash, $createdAt);

            DB::table('printableRecordExports')->where('id', $requestId)->update([
                'documentId' => $archive['documentId'],
                'status' => $requiresApproval ? 'awaiting_approval' : 'ready',
                'releasedAt' => $requiresApproval ? null : $archive['createdAt'],
            ]);

            Audit::write([
                'actorUserId' => $input['requesterId'], 'entityId' => $input['entityId'],
                'propertyId' => $input['propertyId'] ?? null,
                'action' => 'printable_record_export.request', 'resourceType' => 'printable_record_export',
                'resourceId' => $requestId, 'sensitivity' => PrintableExportRules::classification($type),
                'result' => 'success',
                'metadata' => PrintableExportRules::auditMetadata($type, (int) $snapshot['recordCount'], $archive['documentId']),
            ]);

            return ['id' => $requestId, 'status' => $requiresApproval ? 'awaiting_approval' : 'ready'];
        } catch (Throwable $error) {
            $errorCode = PrintableExportRules::failureCode();

            DB::table('printableRecordExports')->where('id', $requestId)
                ->update(['status' => 'failed', 'errorCode' => $errorCode]);

            Audit::write([
                'actorUserId' => $input['requesterId'], 'entityId' => $input['entityId'],
                'propertyId' => $input['propertyId'] ?? null,
                'action' => 'printable_record_export.generate', 'resourceType' => 'printable_record_export',
                'resourceId' => $requestId, 'sensitivity' => PrintableExportRules::classification($type),
                'result' => 'failure', 'reasonCode' => $errorCode,
                'metadata' => PrintableExportRules::auditMetadata($type, (int) $snapshot['recordCount']),
            ]);

            throw new TrpcException(
                'INTERNAL_SERVER_ERROR',
                'The printable record could not be generated. The failed request was retained for audit review.',
            );
        }
    }

    /**
     * @param array<string, mixed> $input
     * @return array{documentId: int, createdAt: int}
     */
    private static function archiveStagedSnapshot(array $input, int $requestId, string $hash, int $createdAt): array
    {
        $snapshot = $input['snapshot'];
        $type = (string) $snapshot['type'];
        $title = PrintableExportRules::title($type);
        $fileName = PrintableExportRules::fileName($type, $requestId, $createdAt);
        $requiresApproval = PrintableExportRules::requiresIndependentApproval($type);

        $bytes = RecordExportPdf::render([
            'title' => $title,
            'entityName' => $snapshot['entityName'],
            'propertyName' => $snapshot['propertyName'] ?? null,
            'placementReference' => $snapshot['placementReference'] ?? null,
            'preferredName' => $snapshot['preferredName'] ?? null,
            'rangeStart' => $input['rangeStart'],
            'rangeEnd' => $input['rangeEnd'],
            'generatedAt' => $createdAt,
            'snapshotHash' => $hash,
            'requestedByName' => $input['requesterName'],
            'sections' => $snapshot['sections'],
        ]);

        $stored = EvidenceStorage::putBytes(
            "entities/{$input['entityId']}/printable-record-exports/$requestId/staged",
            $fileName,
            'application/pdf',
            $bytes,
        );

        $reference = $snapshot['placementReference'] ?? "Export $requestId";
        $documentId = (int) DB::table('documents')->insertGetId([
            'entityId' => $input['entityId'],
            'propertyId' => $input['propertyId'] ?? null,
            'title' => mb_substr("$title · $reference", 0, 240),
            'documentType' => 'generated',
            'classification' => PrintableExportRules::classification($type),
            'status' => $requiresApproval ? 'in_review' : 'approved',
            'retentionBasis' => PrintableExportRules::RETENTION_BASIS,
            'retentionUntil' => $createdAt + PrintableExportRules::RETENTION_MS,
            'createdBy' => $input['requesterId'],
        ]);

        DB::table('documentVersions')->insert([
            'documentId' => $documentId,
            'version' => 1,
            'fileKey' => $stored['key'],
            'fileUrl' => $stored['url'],
            'fileName' => $fileName,
            'mimeType' => 'application/pdf',
            'sizeBytes' => strlen($bytes),
            'contentHash' => hash('sha256', $bytes),
            'scanStatus' => 'not_available',
            'changeSummary' => $requiresApproval
                ? 'Immutable staged printable-record snapshot awaiting independent approval'
                : 'System-generated controlled printable-record snapshot',
            'approvedAt' => $requiresApproval ? null : $createdAt,
            'approvedBy' => $requiresApproval ? null : $input['requesterId'],
            'createdBy' => $input['requesterId'],
        ]);

        return ['documentId' => $documentId, 'createdAt' => $createdAt];
    }

    /** @return array{role: string, propertyIds: array<int, int>} */
    private static function assertShiftExportScope(int $userId, int $entityId, ?int $propertyId): array
    {
        $access = Authz::assertEntityCapability($userId, $entityId, 'shift.read');
        if (!PrintableExportRules::isShiftExportRole($access['role'])) {
            throw TrpcException::forbidden('Only an Owner, RSM, Manager or HR/Compliance user can export shift records.');
        }

        if ($propertyId !== null) {
            Authz::assertPropertyCapability($userId, $entityId, $propertyId, 'shift.read');
        }

        $propertyIds = $propertyId !== null
            ? [$propertyId]
            : Authz::accessiblePropertyIds($userId, $entityId, 'shift.read');

        if ($propertyIds === []) {
            throw TrpcException::forbidden('No authorised property is available for this shift export.');
        }

        return ['role' => (string) $access['role'], 'propertyIds' => $propertyIds];
    }

    /** @return array{role: string, propertyIds: array<int, int>} */
    private static function assertDocumentExportScope(int $userId, int $entityId, ?int $propertyId): array
    {
        $access = Authz::assertEntityCapability($userId, $entityId, 'document.read');
        if (!PrintableExportRules::isDocumentExportRole($access['role'])) {
            throw TrpcException::forbidden('Only an Owner, RSM, Manager or HR/Compliance user can export a controlled document register.');
        }

        if ($propertyId !== null) {
            Authz::assertPropertyCapability($userId, $entityId, $propertyId, 'document.read');
        }

        return [
            'role' => (string) $access['role'],
            'propertyIds' => $propertyId !== null
                ? [$propertyId]
                : Authz::accessiblePropertyIds($userId, $entityId, 'document.read'),
        ];
    }

    /** @return array<string, mixed> */
    private static function assertManagerApprovalRole(int $userId, int $entityId): array
    {
        $access = Authz::assertEntityCapability($userId, $entityId, 'young_person.read');
        if (!PrintableExportRules::isManagerRole($access['role'])) {
            throw TrpcException::forbidden('Only an Owner, RSM or Manager can approve young-person record exports.');
        }

        return $access;
    }

    /** A download is re-checked against the scope the record actually covers. */
    private static function assertExportReadScope(int $userId, object $row): void
    {
        $entityId = (int) $row->entityId;
        $propertyId = $row->propertyId === null ? null : (int) $row->propertyId;

        if ($row->exportType === 'young_person_compilation') {
            if ($row->placementId === null) {
                throw TrpcException::notFound('Export scope is incomplete.');
            }

            Authz::assertCurrentShiftPlacementCapability($userId, (int) $row->placementId, 'young_person.read');

            return;
        }

        if ($row->exportType === 'document_register') {
            self::assertDocumentExportScope($userId, $entityId, $propertyId);

            return;
        }

        if ($row->exportType === 'shift_register') {
            self::assertShiftExportScope($userId, $entityId, $propertyId);

            return;
        }

        $access = Authz::assertEntityCapability($userId, $entityId, 'shift.read');
        if (!PrintableExportRules::isShiftExportRole($access['role']) && (int) $row->requestedBy !== $userId) {
            throw TrpcException::forbidden('You are not authorised to download this controlled timesheet record.');
        }
    }

    private static function loadExport(int $entityId, int $id): object
    {
        $row = DB::table('printableRecordExports as e')
            ->join('users as u', 'u.id', '=', 'e.requestedBy')
            ->where('e.id', $id)->where('e.entityId', $entityId)
            ->first(['e.*', 'u.name as requestedByName']);

        if ($row === null) {
            throw TrpcException::notFound('Printable export request not found.');
        }

        return $row;
    }

    private static function listQuery(int $entityId): \Illuminate\Database\Query\Builder
    {
        return DB::table('printableRecordExports as e')
            ->join('users as u', 'u.id', '=', 'e.requestedBy')
            ->leftJoin('users as r', 'r.id', '=', 'e.reviewedBy')
            ->where('e.entityId', $entityId)
            ->orderByDesc('e.createdAt')
            ->select(['e.*', 'u.name as requestedByName', 'r.name as reviewerName']);
    }

    /** @return array<int, array<string, mixed>> */
    private static function summaries(\Illuminate\Database\Query\Builder $query): array
    {
        return $query->get()
            ->map(static fn ($row) => self::summary($row, $row->requestedByName, $row->reviewerName))
            ->all();
    }

    /** @return array<string, mixed> */
    private static function summary(object $row, ?string $requestedByName, ?string $reviewerName = null): array
    {
        $manifest = json_decode((string) $row->manifest, true);
        $manifest = is_array($manifest) ? $manifest : [];

        return [
            'id' => (int) $row->id,
            'exportType' => $row->exportType,
            'propertyId' => $row->propertyId === null ? null : (int) $row->propertyId,
            'placementId' => $row->placementId === null ? null : (int) $row->placementId,
            'timesheetId' => $row->timesheetId === null ? null : (int) $row->timesheetId,
            'rangeStart' => (int) $row->rangeStart,
            'rangeEnd' => (int) $row->rangeEnd,
            'status' => $row->status,
            'snapshotHash' => $row->snapshotHash,
            'sourceCounts' => $manifest['sourceCounts'] ?? [],
            'recordCount' => $manifest['recordCount'] ?? 0,
            'requestedByName' => $requestedByName ?? 'Authorised user',
            'requestedAt' => Dates::fromDatabase($row->createdAt),
            'reviewerName' => $reviewerName,
            'reviewerRole' => $row->reviewerRole,
            'reviewedAt' => $row->reviewedAt === null ? null : (int) $row->reviewedAt,
            'releasedAt' => $row->releasedAt === null ? null : (int) $row->releasedAt,
            'errorCode' => $row->errorCode,
        ];
    }

    private static function recordCount(object $row): int
    {
        $manifest = json_decode((string) $row->manifest, true);

        return (int) (is_array($manifest) ? ($manifest['recordCount'] ?? 0) : 0);
    }

    private static function entityName(int $entityId): string
    {
        $entity = DB::table('entities')->where('id', $entityId)->first('name');
        if ($entity === null) {
            throw TrpcException::notFound('Entity not found');
        }

        return (string) $entity->name;
    }

    private static function propertyName(int $entityId, ?int $propertyId): ?string
    {
        if ($propertyId === null) {
            return null;
        }

        $property = DB::table('properties')->where('id', $propertyId)->where('entityId', $entityId)->first('name');
        if ($property === null) {
            throw TrpcException::notFound('Property not found');
        }

        return (string) $property->name;
    }

    private static function userName(int $userId): string
    {
        $user = DB::table('users')->where('id', $userId)->first('name');

        return ($user->name ?? null) ?: 'Authorised user';
    }

    private static function requesterName(Context $ctx): string
    {
        return ($ctx->requireUser()['name'] ?? null) ?: 'Authorised user';
    }
}
