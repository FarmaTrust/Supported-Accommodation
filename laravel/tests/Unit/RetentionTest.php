<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Support\InspectionPack;
use App\Support\Retention;
use PHPUnit\Framework\TestCase;
use RuntimeException;

/**
 * Deletion cannot be undone, so both safeguards are tested from the side that
 * matters: not that a legitimate decision is allowed, but that the person who
 * asked for the deletion cannot also grant it, and that a legal hold beats an
 * approval rather than the other way round.
 */
final class RetentionTest extends TestCase
{
    public function test_nobody_approves_their_own_deletion_or_transfer(): void
    {
        foreach (['approved_delete', 'approved_transfer'] as $decision) {
            $verdict = Retention::validateDecision(7, 7, false, $decision);

            self::assertFalse($verdict['allowed']);
            self::assertSame('independent_approval_required', $verdict['reason']);
        }
    }

    public function test_the_requester_may_still_place_a_hold_or_cancel(): void
    {
        self::assertTrue(Retention::validateDecision(7, 7, false, 'hold')['allowed']);
        self::assertTrue(Retention::validateDecision(7, 7, false, 'cancelled')['allowed']);
    }

    public function test_a_legal_hold_beats_an_independent_approval(): void
    {
        $verdict = Retention::validateDecision(7, 9, true, 'approved_delete');

        self::assertFalse($verdict['allowed']);
        self::assertSame('legal_hold', $verdict['reason']);
    }

    public function test_a_held_record_may_still_be_transferred(): void
    {
        self::assertTrue(Retention::validateDecision(7, 9, true, 'approved_transfer')['allowed']);
    }

    public function test_deletion_completes_only_for_an_approved_unheld_document(): void
    {
        self::assertTrue(Retention::canCompleteDeletion('approved_delete', false, 'document'));

        self::assertFalse(Retention::canCompleteDeletion('approved_delete', true, 'document'));
        self::assertFalse(Retention::canCompleteDeletion('pending', false, 'document'));
        self::assertFalse(Retention::canCompleteDeletion('approved_transfer', false, 'document'));

        // Only documents are destroyed this way; a placement or an audit row is not.
        self::assertFalse(Retention::canCompleteDeletion('approved_delete', false, 'placement'));
    }

    public function test_the_queue_state_puts_a_hold_before_every_due_date(): void
    {
        $now = 1789884000000;
        $past = $now - 86400000;
        $future = $now + 86400000;

        self::assertSame('hold', Retention::queueState($past, $past, true, $now));
        self::assertSame('review_due', Retention::queueState($future, $past, false, $now));
        self::assertSame('eligible', Retention::queueState($past, $future, false, $now));
        self::assertSame('scheduled', Retention::queueState($future, $future, false, $now));
    }

    public function test_an_inspection_pack_is_named_for_its_job_and_day(): void
    {
        self::assertSame('inspection-pack-42-2026-09-20.zip', InspectionPack::fileName(42, 1789884000000));
        self::assertSame(hash('sha256', 'bytes'), InspectionPack::contentHash('bytes'));
    }

    public function test_an_oversized_pack_is_refused_before_anything_is_read(): void
    {
        $manifest = ['generatedAt' => 1789884000000];

        $tooMany = array_fill(0, 251, ['source' => 'quality_report', 'sourceId' => 1, 'title' => 'x', 'fileName' => 'x.pdf', 'fileKey' => 'k', 'mimeType' => 'application/pdf', 'sizeBytes' => 1, 'contentHash' => null]);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Inspection pack file limit exceeded');
        InspectionPack::createZip($manifest, 'Smoke Care Ltd', null, [], $tooMany);
    }

    public function test_a_pack_over_the_declared_byte_ceiling_is_refused(): void
    {
        $manifest = ['generatedAt' => 1789884000000];

        $huge = [[
            'source' => 'quality_report', 'sourceId' => 1, 'title' => 'x', 'fileName' => 'x.pdf',
            'fileKey' => 'k', 'mimeType' => 'application/pdf', 'sizeBytes' => 104857601, 'contentHash' => null,
        ]];

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Inspection pack size limit exceeded');
        InspectionPack::createZip($manifest, 'Smoke Care Ltd', null, [], $huge);
    }

    public function test_the_index_renders_and_names_what_is_inside(): void
    {
        $pdf = InspectionPack::renderIndex(
            'Smoke Care Ltd',
            'Rose House',
            1789884000000,
            [[
                'id' => 4, 'title' => 'Quarterly service review', 'propertyName' => 'Rose House',
                'periodStart' => 1787000000000, 'periodEnd' => 1789000000000,
                'approvedAt' => 1789100000000, 'evidenceCount' => 3,
            ]],
            [[
                'source' => 'quality_report', 'sourceId' => 4, 'reviewId' => 4, 'title' => 'QSR-4 report',
                'fileName' => 'qsr-4.pdf', 'fileKey' => 'k', 'mimeType' => 'application/pdf',
                'sizeBytes' => 20480, 'contentHash' => str_repeat('a', 64),
            ]],
        );

        self::assertStringStartsWith('%PDF', $pdf);
        self::assertGreaterThan(1000, strlen($pdf));
    }

    public function test_the_index_renders_when_nothing_matched_the_scope(): void
    {
        $pdf = InspectionPack::renderIndex('Smoke Care Ltd', null, 1789884000000, [], []);

        self::assertStringStartsWith('%PDF', $pdf);
    }
}
