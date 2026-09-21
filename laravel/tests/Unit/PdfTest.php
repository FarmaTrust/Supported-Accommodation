<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Support\InvoicePdf;
use App\Support\Pdf;
use App\Support\StatementPdf;
use PHPUnit\Framework\TestCase;

/**
 * These documents are sent to local authorities, so the checks are about the
 * things that would be wrong without anyone noticing: a total that does not
 * appear, a pound sign that turns into a question mark, a long statement that
 * silently loses rows.
 */
final class PdfTest extends TestCase
{
    /** @return array<string, mixed> */
    private function invoiceInput(): array
    {
        return [
            'invoiceNumber' => 'LSC-000042',
            'invoiceDate' => 1789000000000,
            'dueAt' => 1789600000000,
            'purchaseOrderNumber' => 'PO-99',
            'supplier' => ['name' => 'Smoke Care Ltd', 'address' => '1 Test Street, Testville', 'companyNumber' => '12345678', 'vatNumber' => 'GB123'],
            'customerName' => 'Testshire County Council',
            'customerAddress' => 'County Hall, Testville, TE1 1ST',
            'placementReference' => 'YP-0001',
            'periodStart' => 1786000000000,
            'periodEnd' => 1789000000000,
            'lines' => [
                ['description' => 'Supported accommodation, weekly', 'quantity' => '4', 'unitPrice' => '1250.00', 'vatRate' => '0.00', 'grossAmount' => '5000.00'],
            ],
            'subtotal' => 5000.0,
            'vatTotal' => 0.0,
            'total' => 5000.0,
            'bank' => ['accountName' => 'Smoke Care Ltd', 'sortCode' => '12-34-56', 'accountNumber' => '12345678'],
        ];
    }

    public function test_an_invoice_renders_a_pdf(): void
    {
        $bytes = InvoicePdf::render($this->invoiceInput());

        $this->assertStringStartsWith('%PDF-', $bytes);
        $this->assertStringContainsString('%%EOF', $bytes);
        $this->assertGreaterThan(1000, strlen($bytes));
    }

    public function test_an_invoice_renders_without_bank_details(): void
    {
        // Bank details are omitted unless the caller has the finance capability,
        // so the layout has to hold together without them.
        $input = $this->invoiceInput();
        $input['bank'] = null;

        $this->assertStringStartsWith('%PDF-', InvoicePdf::render($input));
    }

    public function test_an_invoice_with_more_lines_than_fit_still_renders(): void
    {
        $input = $this->invoiceInput();
        $input['lines'] = array_fill(0, 40, $input['lines'][0]);

        $this->assertStringStartsWith('%PDF-', InvoicePdf::render($input));
    }

    public function test_a_statement_runs_onto_further_pages(): void
    {
        $rows = [];
        for ($i = 0; $i < 60; $i++) {
            $rows[] = [
                'invoiceNumber' => sprintf('LSC-%06d', $i), 'invoiceDate' => 1789000000000,
                'dueAt' => 1789600000000, 'purchaseOrderNumber' => 'PO-' . $i,
                'youngPersonReference' => 'YP-' . $i, 'total' => 100.0, 'paid' => 0.0,
                'credited' => 0.0, 'balance' => 100.0, 'status' => 'part_paid',
            ];
        }

        $bytes = StatementPdf::render([
            'entityName' => 'Smoke Care Ltd', 'authorityName' => 'Testshire County Council',
            'startAt' => 1786000000000, 'endAt' => 1789000000000,
            'openingBalance' => 0.0, 'closingBalance' => 6000.0, 'rows' => $rows,
        ]);

        $this->assertStringStartsWith('%PDF-', $bytes);
        // Sixty rows cannot fit one page, so the document must have grown.
        $this->assertGreaterThan(1, substr_count($bytes, '/Type /Page'), 'a long statement should run onto more pages');
    }

    public function test_money_is_formatted_to_pence_with_a_pound_sign(): void
    {
        $this->assertSame('£1250.00', Pdf::money(1250));
        $this->assertSame('£0.50', Pdf::money(0.5));
        $this->assertSame('£-25.00', Pdf::money(-25));
    }

    public function test_a_missing_date_reads_as_a_dash_rather_than_1970(): void
    {
        $this->assertSame('—', Pdf::date(null));
        $this->assertSame('21/09/2025', Pdf::date(1758412800000));
    }

    public function test_wrapping_breaks_on_whole_words(): void
    {
        $lines = Pdf::wrap('County Hall, Testville, Testshire, TE1 1ST', 20);

        $this->assertGreaterThan(1, count($lines));
        foreach ($lines as $line) {
            $this->assertLessThanOrEqual(20, strlen($line));
        }
        $this->assertSame('County Hall,', $lines[0]);
    }

    public function test_wrapping_an_empty_address_produces_nothing(): void
    {
        $this->assertSame([], Pdf::wrap(''));
        $this->assertSame([], Pdf::wrap('   '));
    }
}
