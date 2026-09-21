<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Support\Rules;
use App\Support\Statements;
use App\Trpc\TrpcException;
use PHPUnit\Framework\TestCase;

/**
 * Invoice arithmetic, checked at the places money goes wrong quietly: rounding
 * that drifts a penny per line, a sequence that repeats an invoice number, and
 * a statement range wide enough to pull years of invoices into memory.
 */
final class StatementsTest extends TestCase
{
    public function test_an_invoice_line_rounds_to_pence_at_each_step(): void
    {
        $line = Rules::invoiceLine(4, 1250.00, 20);

        $this->assertSame(5000.0, $line['net']);
        $this->assertSame(1000.0, $line['vat']);
        $this->assertSame(6000.0, $line['gross']);
    }

    public function test_vat_is_rounded_before_it_is_added(): void
    {
        // 0.175 of 33.33 is 5.83275. Rounding at the end instead would leave a
        // gross that does not equal net plus the VAT actually charged.
        $line = Rules::invoiceLine(1, 33.33, 17.5);

        $this->assertSame(33.33, $line['net']);
        $this->assertSame(5.83, $line['vat']);
        $this->assertSame(39.16, $line['gross']);
        $this->assertSame($line['gross'], round($line['net'] + $line['vat'], 2));
    }

    public function test_a_zero_rated_line_charges_no_vat(): void
    {
        $line = Rules::invoiceLine(28, 100.00, 0);

        $this->assertSame(2800.0, $line['net']);
        $this->assertSame(0.0, $line['vat']);
        $this->assertSame(2800.0, $line['gross']);
    }

    public function test_invoice_numbers_are_padded_and_sequential(): void
    {
        $this->assertSame('LSC-000001', Statements::formatInvoiceNumber('LSC', 1));
        $this->assertSame('LSC-000042', Statements::formatInvoiceNumber('LSC', 42));
        $this->assertSame('LSC-123456', Statements::formatInvoiceNumber('LSC', 123456));
    }

    public function test_a_bad_prefix_or_sequence_is_refused(): void
    {
        foreach (['l', 'lower', 'WAY-TOO-LONG-PREFIX', 'HAS SPACE'] as $prefix) {
            try {
                Statements::formatInvoiceNumber($prefix, 1);
                $this->fail("prefix \"$prefix\" should be refused");
            } catch (TrpcException $error) {
                $this->assertSame('BAD_REQUEST', $error->trpcCode);
            }
        }

        $this->expectException(TrpcException::class);
        Statements::formatInvoiceNumber('LSC', 0);
    }

    public function test_a_period_holds_the_right_number_of_billing_units(): void
    {
        // A 28-day period is 28 days, 4 weeks, or one of anything longer.
        $this->assertSame(28, Statements::periodQuantity('daily'));
        $this->assertSame(4, Statements::periodQuantity('weekly'));
        $this->assertSame(1, Statements::periodQuantity('four_week'));
        $this->assertSame(1, Statements::periodQuantity('monthly'));
        $this->assertSame(1, Statements::periodQuantity('fixed'));
    }

    public function test_a_statement_range_must_run_forwards(): void
    {
        Statements::assertRange(1000, 2000);
        Statements::assertRange(2000, 2000);

        $this->expectException(TrpcException::class);
        Statements::assertRange(2000, 1000);
    }

    public function test_a_statement_range_is_capped_at_three_years(): void
    {
        $day = 86400000;
        $end = 1789000000000;

        Statements::assertRange($end - 3 * 366 * $day, $end);

        try {
            Statements::assertRange($end - 4 * 366 * $day, $end);
            $this->fail('a four-year range should be refused');
        } catch (TrpcException $error) {
            $this->assertStringContainsString('three years', $error->getMessage());
        }
    }
}
