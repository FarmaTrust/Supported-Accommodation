<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Support\ReportCompletion;
use PHPUnit\Framework\TestCase;

/**
 * The completion board counts what exists. It must not invent a denominator:
 * the system does not know how many reports a worker was meant to write, and a
 * made-up percentage on a manager's screen is a number a worker would have to
 * answer for.
 */
final class ReportCompletionTest extends TestCase
{
    /** @return array<string, mixed> */
    private function row(int $id, int $propertyId, string $propertyName, int $authorId, ?string $authorName, string $status, int $reportDate): array
    {
        return [
            'id' => $id, 'propertyId' => $propertyId, 'propertyName' => $propertyName,
            'authorUserId' => $authorId, 'authorName' => $authorName,
            'status' => $status, 'reportDate' => $reportDate,
        ];
    }

    public function test_nothing_recorded_summarises_to_nothing(): void
    {
        $this->assertSame([], ReportCompletion::summarise([]));
    }

    public function test_each_status_lands_in_the_roll_ups_it_belongs_to(): void
    {
        $summary = ReportCompletion::summarise([
            $this->row(1, 5, 'Elm House', 9, 'Ada', 'draft', 100),
            $this->row(2, 5, 'Elm House', 9, 'Ada', 'returned', 200),
            $this->row(3, 5, 'Elm House', 9, 'Ada', 'submitted', 300),
            $this->row(4, 5, 'Elm House', 9, 'Ada', 'reviewed', 400),
            $this->row(5, 5, 'Elm House', 9, 'Ada', 'approved', 500),
            $this->row(6, 5, 'Elm House', 9, 'Ada', 'locked', 600),
        ]);

        $counts = $summary[0]['counts'];

        $this->assertSame(4, $counts['logged']);
        $this->assertSame(2, $counts['needsCompletion']);
        $this->assertSame(2, $counts['awaitingReview']);
        $this->assertSame(2, $counts['approvedOrLocked']);
        $this->assertSame(1, $counts['draft']);
        $this->assertSame(600, $summary[0]['latestReportAt']);
    }

    public function test_reports_group_by_property_then_by_worker(): void
    {
        $summary = ReportCompletion::summarise([
            $this->row(1, 7, 'Willow Court', 2, 'Zoe', 'submitted', 100),
            $this->row(2, 7, 'Willow Court', 3, 'Ada', 'draft', 300),
            $this->row(3, 5, 'Elm House', 2, 'Zoe', 'approved', 200),
        ]);

        // Properties and workers are both ordered by name, so the board reads
        // the same way every time it is opened.
        $this->assertSame(['Elm House', 'Willow Court'], array_column($summary, 'propertyName'));
        $this->assertSame(['Ada', 'Zoe'], array_column($summary[1]['keyWorkers'], 'name'));
        $this->assertSame(300, $summary[1]['latestReportAt']);
        $this->assertSame(1, $summary[1]['keyWorkers'][1]['counts']['logged']);
    }

    public function test_a_worker_with_no_name_is_still_nameable(): void
    {
        $summary = ReportCompletion::summarise([$this->row(1, 5, 'Elm House', 42, '  ', 'draft', 100)]);

        $this->assertSame('Key Worker 42', $summary[0]['keyWorkers'][0]['name']);
    }
}
