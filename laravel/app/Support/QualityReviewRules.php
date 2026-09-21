<?php

declare(strict_types=1);

namespace App\Support;

use App\Trpc\TrpcException;

/**
 * The rules around a Regulation 32 quality of support review, mirroring
 * server/services/qualityReviewRules.ts and the quality parts of
 * server/services/upgradeRules.ts.
 *
 * A quality review is the provider's own judgement of how well it is looking
 * after the young people in its care, and it goes to the regulator. Left
 * unchecked it is the document a struggling service most wants to write alone,
 * so the rules here are about who may sign it and what has to be in it before
 * it can be signed at all.
 */
final class QualityReviewRules
{
    private const DAY_MS = 86400000;

    /** Six months, the longest period one review may cover. */
    public const MAX_PERIOD_MS = 184 * self::DAY_MS;

    /** Seven years, the retention period for the finished report. */
    public const RETENTION_MS = 7 * 365 * self::DAY_MS;

    public const RETENTION_BASIS = 'Quality of support review — retain under organisation retention schedule';

    /** Everybody the review has to have tried to consult. */
    public const REQUIRED_AUDIENCES = ['young_person', 'placing_authority', 'staff', 'professional'];

    /** A consultation that has run its course, whatever the answer was. */
    private const SETTLED_RESPONSES = ['responded', 'declined', 'no_response', 'not_applicable'];

    /** The roles that may approve a finished review. */
    private const MANAGER_ROLES = ['owner', 'registered_manager'];

    /** Statuses in which the review is controlled and no longer amendable. */
    public const CONTROLLED_STATUSES = ['approved', 'submitted', 'closed'];

    public static function isReportManager(string $role): bool
    {
        return in_array($role, self::MANAGER_ROLES, true);
    }

    /** The reason the period is unusable, or null when it is fine. */
    public static function periodError(int $start, int $end): ?string
    {
        if ($end <= $start) {
            return 'Review period end must be after its start';
        }

        if ($end - $start > self::MAX_PERIOD_MS) {
            return 'A Regulation 32 review period must be no longer than six months';
        }

        return null;
    }

    /**
     * The required audiences nobody has tried to consult yet.
     *
     * A refusal or no answer counts as consulted: the duty is to ask, and a
     * recorded "they did not want to" is itself evidence.
     *
     * @param array<int, array{audience: string, responseStatus: string}> $rows
     * @return array<int, string>
     */
    public static function missingAudiences(array $rows): array
    {
        $settled = [];
        foreach ($rows as $row) {
            if (in_array($row['responseStatus'], self::SETTLED_RESPONSES, true)) {
                $settled[$row['audience']] = true;
            }
        }

        return array_values(array_filter(
            self::REQUIRED_AUDIENCES,
            static fn (string $audience) => !isset($settled[$audience]),
        ));
    }

    /** @param array<int, int|null> $authors */
    public static function independentReviewAllowed(int $actorId, array $authors): bool
    {
        return !in_array($actorId, $authors, true);
    }

    /**
     * The approval gate. Each refusal is a different failure: nothing to
     * approve, nothing rendered to approve, or the wrong person approving.
     */
    public static function assertIndependentApproval(
        string $status,
        int $reviewerId,
        ?int $createdBy,
        ?int $completedBy,
        ?int $existingReportDocumentId,
    ): void {
        if ($status !== 'report_draft') {
            throw new TrpcException('PRECONDITION_FAILED', 'Only a checked draft quality review can be independently approved.');
        }

        if ($existingReportDocumentId === null) {
            throw new TrpcException('PRECONDITION_FAILED', 'Preview and save the final report draft before requesting independent approval.');
        }

        if ($reviewerId === $createdBy || $reviewerId === $completedBy) {
            throw TrpcException::forbidden('A different authorised Manager, RSM or Owner must approve this quality review.');
        }
    }

    public static function documentTitle(string $title, int $reviewId): string
    {
        return mb_substr("$title · QSR-$reviewId", 0, 240);
    }

    public static function pdfFileName(int $reviewId, string $state, int $timestamp): string
    {
        return sprintf('quality-support-review-%d-%s-%s.pdf', $reviewId, $state, gmdate('Y-m-d', intdiv($timestamp, 1000)));
    }

    /** @return array<string, mixed> */
    public static function auditMetadata(string $state, ?int $documentId, ?int $version, int $evidenceCount, int $consultationCount): array
    {
        return [
            'state' => $state,
            'documentId' => $documentId,
            'version' => $version,
            'evidenceCount' => $evidenceCount,
            'consultationCount' => $consultationCount,
        ];
    }
}
