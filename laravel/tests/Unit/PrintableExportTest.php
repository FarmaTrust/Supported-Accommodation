<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Support\PrintableExportRules;
use App\Support\PrintableSnapshots;
use App\Support\RecordExportPdf;
use App\Trpc\TrpcException;
use PHPUnit\Framework\TestCase;

/**
 * The snapshot hash is the link between a printed page and the system it came
 * from, so it has to survive the port: a request staged by the Node backend
 * must still hash the same here, or a young-person export raised before the
 * cutover could never be approved after it. The rest of these tests are about
 * the second pair of eyes on that approval.
 */
final class PrintableExportTest extends TestCase
{
    private const DAY_MS = 86400000;

    /** Sunday 2026-09-20 06:00 UTC. */
    private const MOMENT = 1789884000000;

    /**
     * Taken from Node: createHash("sha256").update(JSON.stringify(snapshot)).
     * PHP matches it only with JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
     * which is why the snapshot below carries a slash, an ampersand, curly
     * quotes and an em dash.
     */
    private const NODE_HASH = 'd7a974a93019eba53895c90104f2ee35fe5f3a60b540c1dd37b473406c28a928';

    /** @return array<string, mixed> */
    private function snapshot(): array
    {
        return [
            'type' => 'shift_register',
            'entityName' => 'Smoke Care Ltd',
            'propertyName' => 'Rose House — “quoted” & / slashed',
            'recordCount' => 2,
            'sourceCounts' => ['shifts' => 1, 'clockEvents' => 1, 'handovers' => 0],
            'sections' => [
                ['title' => 'Planned and worked shifts', 'records' => [
                    ['occurredAt' => 1789884000000, 'title' => 'Rose House · Support shift', 'detail' => 'Ends 20/09/2026, 14:00:00 UTC · Worker: Alex', 'status' => 'assigned'],
                ]],
                ['title' => 'Clock evidence', 'records' => [
                    ['occurredAt' => 1789887600000, 'title' => 'Rose House · clock in', 'detail' => 'Alex · Location: on site', 'status' => 'on_site'],
                ]],
                ['title' => 'Shift handovers', 'records' => []],
            ],
        ];
    }

    public function test_the_snapshot_hash_matches_the_one_node_produces(): void
    {
        self::assertSame(self::NODE_HASH, PrintableSnapshots::hash($this->snapshot()));
    }

    public function test_reordering_a_snapshot_changes_its_hash(): void
    {
        $reordered = $this->snapshot();
        $reordered['sourceCounts'] = ['clockEvents' => 1, 'shifts' => 1, 'handovers' => 0];

        self::assertNotSame(self::NODE_HASH, PrintableSnapshots::hash($reordered));
    }

    public function test_a_range_must_run_forwards_and_stay_under_three_years(): void
    {
        PrintableExportRules::assertRange(self::MOMENT, self::MOMENT + 366 * 3 * self::DAY_MS);

        $this->expectException(TrpcException::class);
        PrintableExportRules::assertRange(self::MOMENT, self::MOMENT + 366 * 3 * self::DAY_MS + 1);
    }

    public function test_a_backwards_range_is_refused(): void
    {
        $this->expectException(TrpcException::class);
        PrintableExportRules::assertRange(self::MOMENT, self::MOMENT - 1);
    }

    public function test_the_requester_cannot_approve_their_own_young_person_export(): void
    {
        try {
            PrintableExportRules::assertIndependentReview('awaiting_approval', 7, 7, 'approved', null);
            self::fail('A self-approval should be refused.');
        } catch (TrpcException $error) {
            self::assertSame('FORBIDDEN', $error->trpcCode);
        }
    }

    public function test_a_second_person_may_approve_without_notes(): void
    {
        PrintableExportRules::assertIndependentReview('awaiting_approval', 7, 9, 'approved', null);
        $this->addToAssertionCount(1);
    }

    public function test_returning_or_declining_has_to_say_why(): void
    {
        foreach (['returned', 'declined'] as $decision) {
            try {
                PrintableExportRules::assertIndependentReview('awaiting_approval', 7, 9, $decision, 'too short');
                self::fail("A $decision decision should need a reason.");
            } catch (TrpcException $error) {
                self::assertSame('BAD_REQUEST', $error->trpcCode);
            }

            PrintableExportRules::assertIndependentReview('awaiting_approval', 7, 9, $decision, 'Range covers the wrong period.');
        }

        $this->addToAssertionCount(1);
    }

    public function test_an_already_released_export_is_not_reviewed_again(): void
    {
        try {
            PrintableExportRules::assertIndependentReview('ready', 7, 9, 'approved', null);
            self::fail('A released export should not be re-reviewed.');
        } catch (TrpcException $error) {
            self::assertSame('PRECONDITION_FAILED', $error->trpcCode);
        }
    }

    public function test_a_failed_render_can_still_be_reviewed_and_retried(): void
    {
        PrintableExportRules::assertIndependentReview('failed', 7, 9, 'approved', null);
        $this->addToAssertionCount(1);
    }

    public function test_only_a_young_person_compilation_needs_a_second_person(): void
    {
        self::assertTrue(PrintableExportRules::requiresIndependentApproval('young_person_compilation'));

        foreach (['shift_register', 'timesheet', 'document_register'] as $type) {
            self::assertFalse(PrintableExportRules::requiresIndependentApproval($type));
        }
    }

    public function test_each_type_carries_its_own_classification_and_file_name(): void
    {
        self::assertSame('safeguarding', PrintableExportRules::classification('young_person_compilation'));
        self::assertSame('hr', PrintableExportRules::classification('timesheet'));
        self::assertSame('restricted', PrintableExportRules::classification('shift_register'));
        self::assertSame('restricted', PrintableExportRules::classification('document_register'));

        self::assertSame('young-person-record-42-2026-09-20.pdf', PrintableExportRules::fileName('young_person_compilation', 42, self::MOMENT));
        self::assertSame('document-register-7-2026-09-20.pdf', PrintableExportRules::fileName('document_register', 7, self::MOMENT));
    }

    public function test_audit_metadata_omits_a_document_that_does_not_exist_yet(): void
    {
        self::assertSame(
            ['exportType' => 'timesheet', 'recordCount' => 3],
            PrintableExportRules::auditMetadata('timesheet', 3),
        );
        self::assertSame(
            ['exportType' => 'timesheet', 'recordCount' => 3, 'documentId' => 9],
            PrintableExportRules::auditMetadata('timesheet', 3, 9),
        );
    }

    public function test_hr_compliance_may_export_shifts_and_documents_but_not_approve(): void
    {
        self::assertTrue(PrintableExportRules::isShiftExportRole('hr_compliance'));
        self::assertTrue(PrintableExportRules::isDocumentExportRole('hr_compliance'));
        self::assertFalse(PrintableExportRules::isManagerRole('hr_compliance'));

        self::assertFalse(PrintableExportRules::isShiftExportRole('support_worker'));
        self::assertFalse(PrintableExportRules::isManagerRole(null));
    }

    public function test_a_staged_record_renders_without_an_approval_block(): void
    {
        $pdf = RecordExportPdf::render($this->pdfInput());

        self::assertStringStartsWith('%PDF', $pdf);
        self::assertGreaterThan(1000, strlen($pdf));
    }

    public function test_an_approved_record_renders_with_its_certificate(): void
    {
        $staged = RecordExportPdf::render($this->pdfInput());
        $approved = RecordExportPdf::render($this->pdfInput() + [
            'approval' => [
                'approverName' => 'Sam Reviewer',
                'approverRole' => 'registered_manager',
                'approvedAt' => self::MOMENT + 3600000,
                'exportId' => 42,
            ],
        ]);

        self::assertStringStartsWith('%PDF', $approved);

        // The certificate is a whole extra page, so the approved copy is larger.
        self::assertGreaterThan(strlen($staged), strlen($approved));
    }

    /** @return array<string, mixed> */
    private function pdfInput(): array
    {
        $snapshot = $this->snapshot();

        return [
            'title' => PrintableExportRules::title('shift_register'),
            'entityName' => $snapshot['entityName'],
            'propertyName' => $snapshot['propertyName'],
            'rangeStart' => self::MOMENT,
            'rangeEnd' => self::MOMENT + 7 * self::DAY_MS,
            'generatedAt' => self::MOMENT,
            'snapshotHash' => self::NODE_HASH,
            'requestedByName' => 'Alex Requester',
            'sections' => $snapshot['sections'],
        ];
    }
}
