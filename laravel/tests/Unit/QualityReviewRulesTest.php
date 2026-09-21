<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Support\QualityReviewRules;
use App\Trpc\TrpcException;
use PHPUnit\Framework\TestCase;

/**
 * A quality review is the provider's own judgement of its care, written for the
 * regulator. These check the two things that stop it being written alone: every
 * required audience has to have been asked, and somebody other than the authors
 * has to approve it.
 */
final class QualityReviewRulesTest extends TestCase
{
    private const DAY_MS = 86400000;

    public function test_a_period_must_run_forwards_and_last_at_most_six_months(): void
    {
        $start = 1789000000000;

        $this->assertNull(QualityReviewRules::periodError($start, $start + 90 * self::DAY_MS));
        $this->assertSame(
            'Review period end must be after its start',
            QualityReviewRules::periodError($start, $start),
        );
        $this->assertSame(
            'A Regulation 32 review period must be no longer than six months',
            QualityReviewRules::periodError($start, $start + 185 * self::DAY_MS),
        );
        // 184 days is the boundary and is allowed.
        $this->assertNull(QualityReviewRules::periodError($start, $start + 184 * self::DAY_MS));
    }

    public function test_asking_counts_even_when_the_answer_is_no(): void
    {
        $rows = [
            ['audience' => 'young_person', 'responseStatus' => 'responded'],
            ['audience' => 'placing_authority', 'responseStatus' => 'declined'],
            ['audience' => 'staff', 'responseStatus' => 'no_response'],
            ['audience' => 'professional', 'responseStatus' => 'not_applicable'],
        ];

        $this->assertSame([], QualityReviewRules::missingAudiences($rows));
    }

    public function test_an_invitation_nobody_has_answered_is_not_a_consultation(): void
    {
        $rows = [
            ['audience' => 'young_person', 'responseStatus' => 'invited'],
            ['audience' => 'placing_authority', 'responseStatus' => 'planned'],
            ['audience' => 'staff', 'responseStatus' => 'responded'],
        ];

        $this->assertSame(
            ['young_person', 'placing_authority', 'professional'],
            QualityReviewRules::missingAudiences($rows),
        );
    }

    public function test_only_a_checked_draft_with_a_rendered_report_can_be_approved(): void
    {
        $this->expectException(TrpcException::class);
        QualityReviewRules::assertIndependentApproval('evidence_review', 1, 2, 3, 9);
    }

    public function test_a_draft_with_no_rendered_report_cannot_be_approved(): void
    {
        $this->expectException(TrpcException::class);
        QualityReviewRules::assertIndependentApproval('report_draft', 1, 2, 3, null);
    }

    public function test_neither_author_may_approve_their_own_review(): void
    {
        foreach ([[7, 3], [2, 7]] as [$createdBy, $completedBy]) {
            try {
                QualityReviewRules::assertIndependentApproval('report_draft', 7, $createdBy, $completedBy, 9);
                $this->fail('Expected the author to be refused.');
            } catch (TrpcException $error) {
                $this->assertSame('FORBIDDEN', $error->trpcCode);
            }
        }

        // A third person passes all three gates.
        QualityReviewRules::assertIndependentApproval('report_draft', 7, 2, 3, 9);
        $this->assertFalse(QualityReviewRules::independentReviewAllowed(7, [2, 7]));
        $this->assertTrue(QualityReviewRules::independentReviewAllowed(7, [2, 3, null]));
    }

    public function test_only_an_owner_or_registered_manager_signs_a_review_off(): void
    {
        $this->assertTrue(QualityReviewRules::isReportManager('owner'));
        $this->assertTrue(QualityReviewRules::isReportManager('registered_manager'));
        $this->assertFalse(QualityReviewRules::isReportManager('hr_compliance'));
        $this->assertFalse(QualityReviewRules::isReportManager('platform_admin'));
    }

    public function test_the_document_title_stays_within_the_column(): void
    {
        $title = QualityReviewRules::documentTitle(str_repeat('a', 300), 12);

        $this->assertSame(240, mb_strlen($title));
    }

    public function test_the_file_name_carries_the_review_state_and_day(): void
    {
        $this->assertSame(
            'quality-support-review-12-approved-2025-09-22.pdf',
            QualityReviewRules::pdfFileName(12, 'approved', 1758499200000),
        );
    }
}
