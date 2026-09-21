<?php

declare(strict_types=1);

namespace App\Support;

use App\Trpc\TrpcException;

/**
 * Who may ask for a printable record, and who may release one, mirroring
 * server/services/printableRecordExportRules.ts.
 *
 * A young-person compilation is the one export that leaves the system as a
 * paper record of a child's life, so it is the one that needs a second person:
 * the requester cannot approve their own, and a decision to return or decline
 * has to say why. The other three release on request to the roles that are
 * already accountable for the underlying records.
 */
final class PrintableExportRules
{
    public const TYPES = ['young_person_compilation', 'shift_register', 'timesheet', 'document_register'];

    public const DECISIONS = ['approved', 'returned', 'declined'];

    public const RETENTION_BASIS = 'Controlled printable-record export — retain under the entity record-retention schedule';

    public const RETENTION_MS = 7 * 366 * 86400000;

    /** Three years; beyond that a single PDF stops being a usable record. */
    private const MAX_RANGE_MS = 366 * 3 * 86400000;

    public static function assertRange(int $rangeStart, int $rangeEnd): void
    {
        AgePolicy::assertDateRange($rangeStart, $rangeEnd, 'Printable record range', 'rangeEnd');

        if ($rangeEnd - $rangeStart > self::MAX_RANGE_MS) {
            throw WorkspacePolicy::fieldError(
                'date_range_invalid',
                'rangeEnd',
                'Printable record ranges can cover up to three years. Choose a shorter period before requesting the export.',
            );
        }
    }

    public static function assertIndependentReview(string $status, int $requestedBy, int $reviewerId, string $decision, ?string $notes): void
    {
        if (!in_array($status, ['awaiting_approval', 'returned', 'failed'], true)) {
            throw new TrpcException('PRECONDITION_FAILED', 'This export is not awaiting an approval decision.');
        }

        if ($requestedBy === $reviewerId) {
            throw TrpcException::forbidden('A different authorised Manager, RSM or Owner must approve a young-person record export.');
        }

        if ($decision !== 'approved' && ($notes === null || mb_strlen(trim($notes)) < 10)) {
            throw TrpcException::badRequest('Add a clear return or decline reason of at least 10 characters.');
        }
    }

    public static function isManagerRole(?string $role): bool
    {
        return $role === 'owner' || $role === 'registered_manager';
    }

    public static function isShiftExportRole(?string $role): bool
    {
        return self::isManagerRole($role) || $role === 'hr_compliance';
    }

    public static function isDocumentExportRole(?string $role): bool
    {
        return self::isShiftExportRole($role);
    }

    /**
     * Keeps provider and object-store failures stable, so no raw backend
     * detail reaches a stored record or an audit row.
     */
    public static function failureCode(): string
    {
        return 'pdf_generation_failed';
    }

    public static function fileName(string $type, int $reference, int $createdAt): string
    {
        $prefix = match ($type) {
            'young_person_compilation' => 'young-person-record',
            'shift_register' => 'shift-register',
            'timesheet' => 'timesheet',
            default => 'document-register',
        };

        return "$prefix-$reference-" . gmdate('Y-m-d', intdiv($createdAt, 1000)) . '.pdf';
    }

    public static function title(string $type): string
    {
        return match ($type) {
            'young_person_compilation' => 'Young-person record compilation',
            'shift_register' => 'Shift and attendance register',
            'timesheet' => 'Approved timesheet',
            default => 'Controlled document register',
        };
    }

    public static function classification(string $type): string
    {
        return match ($type) {
            'young_person_compilation' => 'safeguarding',
            'timesheet' => 'hr',
            default => 'restricted',
        };
    }

    public static function requiresIndependentApproval(string $type): bool
    {
        return $type === 'young_person_compilation';
    }

    /** @return array<string, mixed> */
    public static function auditMetadata(string $exportType, int $recordCount, ?int $documentId = null): array
    {
        $metadata = ['exportType' => $exportType, 'recordCount' => $recordCount];
        if ($documentId !== null && $documentId !== 0) {
            $metadata['documentId'] = $documentId;
        }

        return $metadata;
    }
}
