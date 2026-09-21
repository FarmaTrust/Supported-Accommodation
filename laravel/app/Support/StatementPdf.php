<?php

declare(strict_types=1);

namespace App\Support;

/**
 * The statement of account, mirroring server/services/statementPdf.ts.
 *
 * One row per invoice across a date range, with the header repeated on each new
 * page so a statement that runs over is still readable on its own.
 */
final class StatementPdf
{
    private const INK = [0.08, 0.1, 0.13];
    private const MUTED = [0.36, 0.4, 0.47];
    private const BLUE = [0.15, 0.38, 0.86];
    private const PALE = [0.88, 0.93, 0.99];
    private const WHITE = [1.0, 1.0, 1.0];
    private const RULE = [0.84, 0.86, 0.88];

    /** @param array<string, mixed> $input */
    public static function render(array $input): string
    {
        $pdf = new Pdf();
        $y = self::header($pdf, $input);

        foreach ($input['rows'] ?? [] as $row) {
            // Start a new page before the row rather than after, so a row is
            // never split across the fold.
            if ($y < 84) {
                $pdf->addPage();
                $y = self::header($pdf, $input);
            }

            $y -= 29;
            $pdf->line(48, $y, 546, $y, 0.5, self::RULE);
            $pdf->text((string) ($row['invoiceNumber'] ?? 'Draft'), 58, $y + 10, 8.5, self::INK, true);
            $pdf->text(Pdf::date($row['invoiceDate']), 145, $y + 10, 8.5);

            $reference = ($row['purchaseOrderNumber'] ?? null)
                ? 'PO ' . $row['purchaseOrderNumber']
                : 'No PO';
            $reference .= ' · ' . ($row['youngPersonReference'] ?? 'No placement ref');
            $pdf->text(substr($reference, 0, 90), 215, $y + 10, 8);

            $pdf->text(str_replace('_', ' ', (string) $row['status']), 375, $y + 10, 8);
            $pdf->text(Pdf::money((float) $row['balance']), 468, $y + 10, 8.5, self::INK, true);
        }

        $pdf->text(
            'Generated from finance records at the selected date range. Use secure delivery controls for Local Authority distribution.',
            48, 42, 7.5, self::MUTED,
        );

        return $pdf->output();
    }

    /** @param array<string, mixed> $input */
    private static function header(Pdf $pdf, array $input): float
    {
        $pdf->rect(0, 806, Pdf::WIDTH, 36, self::BLUE);
        $pdf->text((string) $input['entityName'], 48, 770, 18, self::INK, true);
        $pdf->text('STATEMENT OF ACCOUNT', 360, 770, 14, self::INK, true);
        $pdf->text('Customer: ' . $input['authorityName'], 48, 741, 10, self::MUTED);
        $pdf->text(
            'Period: ' . Pdf::date($input['startAt']) . ' – ' . Pdf::date($input['endAt']),
            48, 725, 9, self::MUTED,
        );

        $pdf->rect(48, 661, 498, 42, self::PALE);
        $pdf->text('Opening balance  ' . Pdf::money((float) $input['openingBalance']), 62, 682, 10, self::INK, true);
        $pdf->text('Closing balance  ' . Pdf::money((float) $input['closingBalance']), 315, 682, 10, self::INK, true);

        $y = 635.0;
        $pdf->rect(48, $y, 498, 22, self::INK);
        foreach ([['Invoice', 58], ['Date', 145], ['PO / reference', 215], ['Status', 375], ['Balance', 468]] as [$label, $x]) {
            $pdf->text($label, (float) $x, $y + 7, 8, self::WHITE, true);
        }

        return $y;
    }
}
