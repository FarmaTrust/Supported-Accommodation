<?php

declare(strict_types=1);

namespace App\Support;

/**
 * The invoice document, mirroring server/services/invoicePdf.ts.
 *
 * Laid out by absolute position, with the same coordinates as the Node
 * renderer, so the two produce the same page. It is rendered from the issued
 * snapshot rather than from live records: an invoice already sent to a local
 * authority must keep saying what it said when it was sent.
 */
final class InvoicePdf
{
    private const INK = [0.08, 0.1, 0.13];
    private const MUTED = [0.36, 0.4, 0.47];
    private const BLUE = [0.15, 0.38, 0.86];
    private const PALE_BLUE = [0.88, 0.93, 0.99];
    private const BLUSH = [0.98, 0.89, 0.9];
    private const WHITE = [1.0, 1.0, 1.0];
    private const RULE = [0.84, 0.86, 0.88];
    private const PANEL = [0.95, 0.96, 0.97];
    private const PAYMENT_PANEL = [0.96, 0.96, 0.97];

    /** At most twelve lines fit the page; the rest belong on a schedule. */
    private const MAX_LINES = 12;

    /** @param array<string, mixed> $input */
    public static function render(array $input): string
    {
        $pdf = new Pdf();
        $supplier = $input['supplier'] ?? [];

        $pdf->rect(0, 806, Pdf::WIDTH, 36, self::BLUE);
        $pdf->rect(420, 746, 125, 18, self::BLUSH);

        $pdf->text((string) ($supplier['name'] ?? 'Supplier'), 50, 770, 20, self::INK, true);
        $pdf->text('INVOICE', 440, 772, 24, self::INK, true);
        $pdf->text((string) ($supplier['address'] ?? ''), 50, 750, 9, self::MUTED);
        $pdf->text('Company number ' . ($supplier['companyNumber'] ?? '—'), 50, 732, 8.5, self::MUTED);
        $pdf->text('VAT number ' . ($supplier['vatNumber'] ?? '—'), 50, 718, 8.5, self::MUTED);

        $pdf->text((string) $input['invoiceNumber'], 440, 735, 11, self::INK, true);
        $pdf->text('Invoice date  ' . Pdf::date($input['invoiceDate']), 440, 716, 8.5, self::MUTED);
        $pdf->text('Due date  ' . Pdf::date($input['dueAt'] ?? null), 440, 702, 8.5, self::MUTED);

        $pdf->rect(50, 610, 230, 76, self::PALE_BLUE);
        $pdf->text('BILL TO', 64, 664, 8, self::BLUE, true);
        $pdf->text((string) ($input['customerName'] ?? 'Authority'), 64, 644, 11, self::INK, true);
        foreach (array_slice(Pdf::wrap((string) ($input['customerAddress'] ?? ''), 42), 0, 2) as $i => $line) {
            $pdf->text($line, 64, 627 - $i * 13, 8.5, self::MUTED);
        }

        $pdf->rect(300, 610, 245, 76, self::PANEL);
        $pdf->text('PLACEMENT & PERIOD', 314, 664, 8, self::MUTED, true);
        $pdf->text((string) ($input['placementReference'] ?? '—'), 314, 644, 11, self::INK, true);
        $pdf->text(Pdf::date($input['periodStart']) . ' – ' . Pdf::date($input['periodEnd']), 314, 627, 8.5, self::MUTED);
        // "not supplied" rather than blank: a missing purchase order is a fact
        // the authority needs to see, not an empty space.
        $pdf->text('PO ' . ($input['purchaseOrderNumber'] ?? 'not supplied'), 314, 614, 8.5, self::MUTED);

        $y = 570.0;
        $pdf->rect(50, $y, 495, 26, self::INK);
        $pdf->text('Description', 62, $y + 9, 8.5, self::WHITE, true);
        $pdf->text('Qty', 350, $y + 9, 8.5, self::WHITE, true);
        $pdf->text('Rate', 400, $y + 9, 8.5, self::WHITE, true);
        $pdf->text('Gross', 486, $y + 9, 8.5, self::WHITE, true);

        foreach (array_slice($input['lines'] ?? [], 0, self::MAX_LINES) as $line) {
            $y -= 32;
            $pdf->line(50, $y, 545, $y, 0.5, self::RULE);
            $pdf->text(substr((string) $line['description'], 0, 55), 62, $y + 11, 8.5);
            $pdf->text((string) $line['quantity'], 350, $y + 11, 8.5);
            $pdf->text(Pdf::money((float) $line['unitPrice']), 400, $y + 11, 8.5);
            $pdf->text(Pdf::money((float) $line['grossAmount']), 486, $y + 11, 8.5, self::INK, true);
        }

        $totalsY = max(210.0, $y - 48);
        $pdf->text('Subtotal', 400, $totalsY, 9, self::MUTED);
        $pdf->text(Pdf::money((float) $input['subtotal']), 490, $totalsY, 9, self::INK, true);
        $pdf->text('VAT', 400, $totalsY - 20, 9, self::MUTED);
        $pdf->text(Pdf::money((float) $input['vatTotal']), 490, $totalsY - 20, 9, self::INK, true);
        $pdf->line(395, $totalsY - 31, 545, $totalsY - 31, 1, self::INK);
        $pdf->text('TOTAL', 400, $totalsY - 51, 11, self::INK, true);
        $pdf->text(Pdf::money((float) $input['total']), 485, $totalsY - 51, 13, self::BLUE, true);

        $bank = $input['bank'] ?? null;
        if (is_array($bank) && ($bank['accountName'] ?? null)) {
            $pdf->rect(50, 105, 300, 72, self::PAYMENT_PANEL);
            $pdf->text('PAYMENT DETAILS', 64, 155, 8, self::MUTED, true);
            $pdf->text((string) $bank['accountName'], 64, 136, 9);
            $pdf->text(
                'Sort code ' . ($bank['sortCode'] ?? '—') . '   Account ' . ($bank['accountNumber'] ?? '—'),
                64, 119, 9,
            );
        }

        $pdf->text('Generated from an immutable issued-invoice snapshot.', 50, 54, 8, self::MUTED);
        $pdf->rect(50, 36, 64, 4, self::BLUE);
        $pdf->rect(118, 36, 28, 4, self::BLUSH);

        return $pdf->output();
    }
}
