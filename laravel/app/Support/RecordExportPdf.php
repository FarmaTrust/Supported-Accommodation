<?php

declare(strict_types=1);

namespace App\Support;

/**
 * The printable record itself, mirroring server/services/recordExportPdf.ts.
 *
 * The front page carries the period, the scope, who asked for it and the
 * SHA-256 of the snapshot it was rendered from, so a printed copy can be
 * checked against the system it came from. Until a second person approves it,
 * the amber banner says so on every copy; after approval the green banner and
 * a certificate page name the approver.
 */
final class RecordExportPdf
{
    private const LEFT = 48.0;

    private const RIGHT = 547.0;

    private const INK = [0.075, 0.09, 0.13];

    private const MUTED = [0.36, 0.4, 0.47];

    private const BLUE = [0.1, 0.32, 0.74];

    private const PALE_BLUE = [0.9, 0.94, 1.0];

    private const PALE_GREEN = [0.9, 0.97, 0.93];

    private const PALE_AMBER = [1.0, 0.95, 0.84];

    private const EDGE = [0.82, 0.85, 0.89];

    private Pdf $pdf;

    private float $y = 0.0;

    private int $pages = 1;

    private string $entityName;

    private function __construct(string $entityName)
    {
        $this->pdf = new Pdf();
        $this->entityName = $entityName;
        $this->banner();
    }

    /**
     * @param array{title: string, entityName: string, propertyName?: string|null, placementReference?: string|null, preferredName?: string|null, rangeStart: int, rangeEnd: int, generatedAt: int, snapshotHash: string, requestedByName: string, approval?: array{approverName: string, approverRole: string, approvedAt: int, exportId: int}|null, sections: array<int, array<string, mixed>>} $input
     */
    public static function render(array $input): string
    {
        $doc = new self($input['entityName']);
        $doc->body($input);

        if (($input['approval'] ?? null) !== null) {
            $doc->certificate($input);
        }

        $doc->footer();

        return $doc->pdf->output();
    }

    /** @param array<string, mixed> $input */
    private function body(array $input): void
    {
        $width = self::RIGHT - self::LEFT;

        $this->at(mb_strtoupper((string) $input['title']), self::LEFT, 18, true);
        $this->y -= 22;
        $this->at('Factual printable record snapshot', self::LEFT, 9, false, self::MUTED);
        $this->y -= 18;

        $this->pdf->rect(self::LEFT, $this->y - 81, $width, 78, self::PALE_BLUE);
        $this->y -= 17;
        $this->meta('Period', self::period((int) $input['rangeStart'], (int) $input['rangeEnd']));
        $this->meta('Property', $input['propertyName'] ?? 'Entity-level record');
        $this->meta('Young person', ($input['placementReference'] ?? null) === null
            ? 'Not applicable'
            : $input['placementReference'] . (($input['preferredName'] ?? null) === null ? '' : ' — ' . $input['preferredName']));
        $this->meta('Requested by', (string) $input['requestedByName']);
        $this->y -= 8;

        $approval = $input['approval'] ?? null;
        if ($approval !== null) {
            $this->ensure(60);
            $this->pdf->rect(self::LEFT, $this->y - 44, $width, 42, self::PALE_GREEN);
            $this->y -= 15;
            $this->at('INDEPENDENT APPROVAL', self::LEFT + 12, 8, true, [0.08, 0.34, 0.17]);
            $this->y -= 13;
            $this->at(sprintf(
                '%s · %s · %s',
                str_replace('_', ' ', (string) $approval['approverRole']),
                $approval['approverName'],
                self::moment((int) $approval['approvedAt']),
            ), self::LEFT + 12, 8.5);
            $this->y -= 24;
        } else {
            $this->ensure(48);
            $this->pdf->rect(self::LEFT, $this->y - 34, $width, 32, self::PALE_AMBER);
            $this->y -= 14;
            $this->at('STAGED SNAPSHOT — independent approval evidence is appended before controlled release.', self::LEFT + 12, 8, true, [0.45, 0.28, 0.02]);
            $this->y -= 20;
        }

        foreach ($input['sections'] as $section) {
            $this->ensure(42);
            $this->pdf->rect(self::LEFT, $this->y - 20, $width, 20, self::INK);
            $this->at(mb_strtoupper((string) $section['title']), self::LEFT + 10, 8, true, [1, 1, 1]);
            $this->y -= 30;

            if ($section['records'] === []) {
                $this->at('No records fall within the selected date range.', self::LEFT, 8.5, false, self::MUTED);
                $this->y -= 17;

                continue;
            }

            foreach ($section['records'] as $record) {
                $this->record($record);
            }

            $this->y -= 4;
        }

        $this->ensure(40);
        $this->at('Snapshot SHA-256: ' . $input['snapshotHash'], self::LEFT, 7.2, false, self::MUTED);
        $this->y -= 12;
        $this->at(
            'Generated: ' . self::moment((int) $input['generatedAt']) . ' · This is a fictional TEST platform record.',
            self::LEFT, 7.2, false, self::MUTED,
        );
    }

    /** @param array<string, mixed> $record */
    private function record(array $record): void
    {
        $body = self::join("\n", [$record['detail'] ?? null, $record['notes'] ?? null]);

        $height = 25 + count(Pdf::wrap((string) $record['title'], 68)) * 14 + count(Pdf::wrap($body, 84)) * 12;
        $this->ensure((float) min($height, 180));

        $this->wrapped((string) $record['title'], 10, true, self::INK, 68);

        $metadata = self::join(' · ', array_filter([
            self::moment($record['occurredAt'] ?? null),
            ($record['status'] ?? null) === null ? null : str_replace('_', ' ', (string) $record['status']),
        ], static fn (?string $value) => $value !== null && $value !== '' && $value !== '—'));

        if ($metadata !== '') {
            $this->at($metadata, self::LEFT, 7.8, false, self::MUTED);
            $this->y -= 13;
        }

        if ($body !== '') {
            $this->wrapped($body, 8.5, false, self::INK, 84);
        }

        $this->pdf->line(self::LEFT, $this->y - 3, self::RIGHT, $this->y - 3, 0.5, self::EDGE);
        $this->y -= 13;
    }

    /**
     * The approval certificate. It releases the snapshot named by its hash; it
     * does not restate the record, and it changes nothing in the source data.
     *
     * @param array<string, mixed> $input
     */
    private function certificate(array $input): void
    {
        $approval = $input['approval'];
        $width = self::RIGHT - self::LEFT;

        $this->newPage();
        $this->pdf->text('APPROVAL CERTIFICATE', self::LEFT, Pdf::HEIGHT - 88, 18, self::INK, true);
        $this->pdf->text((string) $input['title'], self::LEFT, Pdf::HEIGHT - 112, 10, self::MUTED);
        $this->pdf->rect(self::LEFT, Pdf::HEIGHT - 270, $width, 118, self::PALE_GREEN);

        $facts = [
            ['Decision', 'Approved for controlled release'],
            ['Approver', (string) $approval['approverName']],
            ['Role', str_replace('_', ' ', (string) $approval['approverRole'])],
            ['Approved at', self::moment((int) $approval['approvedAt'])],
            ['Export reference', 'PRE-' . $approval['exportId']],
        ];

        foreach ($facts as $index => [$label, $value]) {
            $lineY = Pdf::HEIGHT - 178 - $index * 18;
            $this->pdf->text("$label:", self::LEFT + 14, $lineY, 8.5, self::MUTED, true);
            $this->pdf->text($value, self::LEFT + 118, $lineY, 8.5, self::INK);
        }

        $this->pdf->text('This certificate releases the staged immutable snapshot identified below. It does not alter source records.', self::LEFT, Pdf::HEIGHT - 306, 8.5, self::MUTED);
        $this->pdf->text('Snapshot SHA-256: ' . $input['snapshotHash'], self::LEFT, Pdf::HEIGHT - 326, 7.5, self::MUTED);
        $this->y = 72;
    }

    /**
     * ponytail: the page furniture is stamped on the last page only. pdf-lib
     * revisits finished pages to number them; FPDF needs a page-alias pass,
     * and the hash on the front page is what proves the record is whole.
     */
    private function footer(): void
    {
        $this->pdf->line(self::LEFT, 51, self::RIGHT, 51, 0.5, self::EDGE);
        $this->pdf->text('Controlled printable record · do not treat as a real operational record', self::LEFT, 36, 7.2, self::MUTED);
        $this->pdf->text("Page $this->pages of $this->pages", Pdf::WIDTH - 92, 36, 7.2, self::MUTED);
    }

    private function banner(): void
    {
        $this->pdf->rect(0, Pdf::HEIGHT - 38, Pdf::WIDTH, 38, self::BLUE);
        $this->pdf->text(mb_substr($this->entityName, 0, 70), self::LEFT, Pdf::HEIGHT - 24, 11, [1, 1, 1], true);
        $this->y = Pdf::HEIGHT - 62;
    }

    private function newPage(): void
    {
        $this->pdf->addPage();
        $this->pages++;
        $this->banner();
    }

    private function ensure(float $height): void
    {
        if ($this->y - $height < 72) {
            $this->newPage();
        }
    }

    /** @param array{0: float, 1: float, 2: float} $colour */
    private function at(string $value, float $x, float $size, bool $bold = false, array $colour = self::INK): void
    {
        $this->pdf->text($value, $x, $this->y, $size, $colour, $bold);
    }

    /** @param array{0: float, 1: float, 2: float} $colour */
    private function wrapped(string $value, float $size, bool $bold, array $colour, int $width): void
    {
        foreach (Pdf::wrap($value, $width) as $line) {
            $this->ensure($size + 7);
            $this->pdf->text($line, self::LEFT, $this->y, $size, $colour, $bold);
            $this->y -= $size + 4;
        }
    }

    private function meta(string $label, string $value): void
    {
        $this->ensure(18);
        $this->pdf->text("$label:", self::LEFT, $this->y, 8, self::MUTED, true);
        $this->pdf->text($value, self::LEFT + 105, $this->y, 8.5, self::INK);
        $this->y -= 15;
    }

    /** "20 Sep 2026, 14:00 UTC", as Date#toLocaleString("en-GB") with a medium date renders it. */
    private static function moment(?int $millis): string
    {
        return $millis === null ? '—' : gmdate('j M Y, H:i', intdiv($millis, 1000)) . ' UTC';
    }

    private static function period(int $start, int $end): string
    {
        return gmdate('d/m/Y', intdiv($start, 1000)) . ' – ' . gmdate('d/m/Y', intdiv($end, 1000));
    }

    /** @param array<int, string|null> $parts */
    private static function join(string $glue, array $parts): string
    {
        return implode($glue, array_filter($parts, static fn (?string $part) => $part !== null && $part !== ''));
    }
}
