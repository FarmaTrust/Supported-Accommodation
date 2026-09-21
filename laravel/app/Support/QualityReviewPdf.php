<?php

declare(strict_types=1);

namespace App\Support;

/**
 * The printable quality of support review, mirroring
 * server/services/qualityReviewPdf.ts.
 *
 * Node renders the draft with pdf-lib and, at approval, loads those same bytes
 * back and adds a certificate page to them. FPDF cannot import an existing PDF,
 * so the approved copy is rendered here in one pass: the same body, then the
 * certificate. The router only does that after checking nothing behind the
 * report has moved since the draft was prepared, so the approver still signs
 * what they read.
 *
 * The body keeps the draft banner even in the approved copy, exactly as Node's
 * does, because the approval is the certificate page rather than a change to
 * the report.
 */
final class QualityReviewPdf
{
    private const LEFT = 48.0;

    private const RIGHT = 547.0;

    private const INK = [0.075, 0.09, 0.13];

    private const MUTED = [0.36, 0.4, 0.47];

    private const BLUE = [0.1, 0.32, 0.74];

    private const AMBER_INK = [0.45, 0.28, 0.02];

    private const PALE_BLUE = [0.9, 0.94, 1.0];

    private const PALE_AMBER = [1.0, 0.95, 0.84];

    private const PALE_GREEN = [0.9, 0.97, 0.93];

    private const EDGE = [0.82, 0.85, 0.89];

    private Pdf $pdf;

    private float $y = 0.0;

    private int $pages = 1;

    private function __construct(private readonly string $entityName)
    {
        $this->pdf = new Pdf();
        $this->banner();
    }

    /**
     * @param array{
     *   entityName: string, propertyName?: string|null, title: string, reviewId: int,
     *   periodStart: int, periodEnd: int, generatedAt: int, generatedBy: string,
     *   methodology: string, strengths: string, shortfalls: string, outcomesSummary: string,
     *   youngPeopleSummary: string, consultationSummary: string, managementEvaluation: string,
     *   evidence: array<int, array<string, mixed>>, consultations: array<int, array<string, mixed>>,
     *   approval?: array{approverName: string, approverRole: string, approvedAt: int}|null
     * } $input
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

        $this->at('QUALITY OF SUPPORT REVIEW', self::LEFT, 18, true);
        $this->y -= 22;
        $this->at((string) $input['title'], self::LEFT, 10, false, self::MUTED);
        $this->y -= 18;

        $this->pdf->rect(self::LEFT, $this->y - 70, $width, 67, self::PALE_BLUE);
        $this->y -= 17;
        $this->meta('Review period', self::period((int) $input['periodStart'], (int) $input['periodEnd']));
        $this->meta('Premise', $input['propertyName'] ?? 'Entity-wide review');
        $this->meta('Prepared by', $input['generatedBy'] . ' · ' . self::moment((int) $input['generatedAt']));
        $this->y -= 9;

        // The banner says draft on every copy. What makes a report controlled is
        // the certificate page, not a word changed on the front.
        $this->ensure(48);
        $this->pdf->rect(self::LEFT, $this->y - 34, $width, 32, self::PALE_AMBER);
        $this->y -= 14;
        $this->at(
            'DRAFT QUALITY REVIEW — check and amend before independent approval',
            self::LEFT + 12, 8, true, self::AMBER_INK,
        );
        $this->y -= 20;

        foreach ([
            'Methodology' => 'methodology',
            'Strengths' => 'strengths',
            'Shortfalls and improvement themes' => 'shortfalls',
            'Outcomes summary' => 'outcomesSummary',
            'Young people\'s views' => 'youngPeopleSummary',
            'Consultation summary' => 'consultationSummary',
            'Management evaluation' => 'managementEvaluation',
        ] as $heading => $key) {
            $this->section($heading);
            $this->wrapped(
                ((string) ($input[$key] ?? '')) === '' ? 'No narrative has been recorded.' : (string) $input[$key],
                8.8, false, self::INK, 88,
            );
            $this->y -= 6;
        }

        $this->section('Consultation record');
        if ($input['consultations'] === []) {
            $this->wrapped('No consultation entries are attached to this report.', 8.5, false, self::MUTED, 88);
        }
        foreach ($input['consultations'] as $item) {
            $this->ensure(34);
            $this->wrapped(sprintf(
                '%s · %s · %s',
                self::readable($item['audience'] ?? null),
                self::readable($item['method'] ?? null),
                self::readable($item['responseStatus'] ?? null),
            ), 8.6, true, self::INK, 84);
            if (($item['summary'] ?? null) !== null && $item['summary'] !== '') {
                $this->wrapped((string) $item['summary'], 8.2, false, self::MUTED, 92);
            }
            $this->y -= 4;
        }

        $this->section('Evidence register');
        if ($input['evidence'] === []) {
            $this->wrapped('No evidence entries are attached to this report.', 8.5, false, self::MUTED, 88);
        }
        foreach ($input['evidence'] as $item) {
            $this->ensure(34);
            $this->wrapped(sprintf(
                '%s · %s · %s%s',
                (string) $item['title'],
                self::readable($item['category'] ?? null),
                self::readable($item['status'] ?? null),
                ($item['documentAttached'] ?? false) ? ' · controlled file attached' : '',
            ), 8.6, true, self::INK, 84);
            if (($item['analysis'] ?? null) !== null && $item['analysis'] !== '') {
                $this->wrapped((string) $item['analysis'], 8.2, false, self::MUTED, 92);
            }
            $this->y -= 4;
        }

        $this->ensure(34);
        $this->at(
            'Generated ' . self::moment((int) $input['generatedAt']) . '. This is a fictional TEST platform record.',
            self::LEFT, 7.2, false, self::MUTED,
        );
    }

    /**
     * The approval certificate: who approved, in what role and when. It says
     * nothing about the findings, because approving is not the same as agreeing.
     *
     * @param array<string, mixed> $input
     */
    private function certificate(array $input): void
    {
        $approval = $input['approval'];
        $width = self::RIGHT - self::LEFT;

        $this->newPage();
        $this->pdf->text('INDEPENDENT APPROVAL CERTIFICATE', self::LEFT, Pdf::HEIGHT - 88, 18, self::INK, true);
        $this->pdf->text(mb_substr((string) $input['title'], 0, 90), self::LEFT, Pdf::HEIGHT - 112, 10, self::MUTED);
        $this->pdf->rect(self::LEFT, Pdf::HEIGHT - 248, $width, 94, self::PALE_GREEN);

        $facts = [
            ['Decision', 'Approved for controlled release'],
            ['Approver', (string) $approval['approverName']],
            ['Role', self::readable((string) $approval['approverRole'])],
            ['Approved at', self::moment((int) $approval['approvedAt'])],
            ['Review reference', 'QSR-' . (int) $input['reviewId']],
        ];

        foreach ($facts as $index => [$label, $value]) {
            $lineY = Pdf::HEIGHT - 178 - $index * 16;
            $this->pdf->text("$label:", self::LEFT + 14, $lineY, 8.5, self::MUTED, true);
            $this->pdf->text($value, self::LEFT + 124, $lineY, 8.5, self::INK);
        }

        $this->pdf->text(
            'The approved PDF preserves the draft report as reviewed at the stated time. It does not alter source evidence or consultation records.',
            self::LEFT, Pdf::HEIGHT - 286, 8.3, self::MUTED,
        );
        $this->y = 72;
    }

    /**
     * ponytail: the page furniture is stamped on the last page only, as in the
     * printable record export. pdf-lib revisits finished pages to number them;
     * FPDF would need a page-alias pass for the same effect.
     */
    private function footer(): void
    {
        $this->pdf->line(self::LEFT, 51, self::RIGHT, 51, 0.5, self::EDGE);
        $this->pdf->text('Quality of support review · controlled record', self::LEFT, 36, 7.2, self::MUTED);
        $this->pdf->text("Page $this->pages of $this->pages", Pdf::WIDTH - 92, 36, 7.2, self::MUTED);
    }

    private function banner(): void
    {
        $this->pdf->rect(0, Pdf::HEIGHT - 38, Pdf::WIDTH, 38, self::BLUE);
        $this->pdf->text(mb_substr($this->entityName, 0, 70), self::LEFT, Pdf::HEIGHT - 24, 11, [1, 1, 1], true);
        $this->y = Pdf::HEIGHT - 62;
    }

    private function section(string $title): void
    {
        $this->ensure(34);
        $this->pdf->rect(self::LEFT, $this->y - 20, self::RIGHT - self::LEFT, 20, self::INK);
        $this->pdf->text(mb_strtoupper($title), self::LEFT + 10, $this->y, 8, [1, 1, 1], true);
        $this->y -= 30;
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
        $this->pdf->text("$label:", self::LEFT + 12, $this->y, 8, self::MUTED, true);
        $this->pdf->text($value, self::LEFT + 110, $this->y, 8.5, self::INK);
        $this->y -= 15;
    }

    private static function readable(?string $value): string
    {
        return $value === null || $value === '' ? 'Not recorded' : str_replace('_', ' ', $value);
    }

    private static function period(int $start, int $end): string
    {
        return gmdate('d/m/Y', intdiv($start, 1000)) . ' – ' . gmdate('d/m/Y', intdiv($end, 1000));
    }

    private static function moment(int $millis): string
    {
        return gmdate('j M Y, H:i', intdiv($millis, 1000)) . ' UTC';
    }
}
