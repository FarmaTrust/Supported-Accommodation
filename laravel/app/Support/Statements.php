<?php

declare(strict_types=1);

namespace App\Support;

use App\Trpc\TrpcException;
use Illuminate\Support\Facades\DB;

/**
 * Statement of account arithmetic, mirroring server/services/statementArchive.ts
 * and server/services/statementRules.ts.
 *
 * What an authority owes at a date is worked out from the invoices, the
 * payments received and the credits issued, each up to that date — never from a
 * running balance held on a row. A stored balance drifts the moment a payment is
 * backdated or a credit is issued late; recomputing cannot.
 */
final class Statements
{
    private const DAY = 86400000;
    private const MAX_RANGE_MS = 3 * 366 * self::DAY;

    public static function assertRange(int $startAt, int $endAt): void
    {
        if ($startAt > $endAt) {
            throw TrpcException::badRequest(
                'Statement start date must be on or before the end date. Correct the dates and try again.'
            );
        }

        // A longer range would pull the whole invoice history into memory on
        // shared hosting, and three years covers what an authority asks for.
        if ($startAt < $endAt - self::MAX_RANGE_MS) {
            throw TrpcException::badRequest(
                'Statements can cover up to three years. Choose a more recent start date.'
            );
        }
    }

    /**
     * @return array{startAt: int, endAt: int, openingBalance: float, closingBalance: float, rows: array<int, array<string, mixed>>}
     */
    public static function calculate(int $entityId, ?int $localAuthorityId, int $startAt, int $endAt): array
    {
        self::assertRange($startAt, $endAt);

        $query = DB::table('invoices')->where('entityId', $entityId)->where('invoiceDate', '<=', $endAt);
        if ($localAuthorityId !== null) {
            $query->where('localAuthorityId', $localAuthorityId);
        }

        $invoices = $query->get();
        $invoiceIds = $invoices->pluck('id')->map(static fn ($id) => (int) $id)->all();

        $credits = $invoiceIds === [] ? collect()
            : DB::table('creditNotes')->whereIn('invoiceId', $invoiceIds)->get();
        $payments = $invoiceIds === [] ? collect()
            : DB::table('payments')->whereIn('invoiceId', $invoiceIds)->get();

        // What is still owed on one invoice as at a moment in time.
        $balanceAt = static function (object $invoice, int $at) use ($credits, $payments): float {
            $paid = $payments
                ->filter(static fn ($p) => (int) $p->invoiceId === (int) $invoice->id && (int) $p->receivedAt <= $at)
                ->sum(static fn ($p) => (float) $p->amount);

            // Only issued credits count; a draft credit note has not reduced
            // anything yet.
            $credited = $credits
                ->filter(static fn ($c) => (int) $c->invoiceId === (int) $invoice->id
                    && $c->status === 'issued' && (int) $c->creditDate <= $at)
                ->sum(static fn ($c) => (float) $c->total);

            return max(0.0, round((float) $invoice->total - $paid - $credited, 2));
        };

        // Void invoices are excluded from every total: they were withdrawn, not
        // written off, and were never owed.
        $live = $invoices->reject(static fn ($row) => $row->status === 'void');

        $openingBalance = $live
            ->filter(static fn ($row) => (int) $row->invoiceDate < $startAt)
            ->sum(static fn ($row) => $balanceAt($row, $startAt - 1));

        $rows = [];
        foreach ($live->filter(static fn ($row) => (int) $row->invoiceDate >= $startAt) as $invoice) {
            $paidInRange = $payments
                ->filter(static fn ($p) => (int) $p->invoiceId === (int) $invoice->id
                    && (int) $p->receivedAt >= $startAt && (int) $p->receivedAt <= $endAt)
                ->sum(static fn ($p) => (float) $p->amount);

            $credited = $credits
                ->filter(static fn ($c) => (int) $c->invoiceId === (int) $invoice->id
                    && $c->status === 'issued' && (int) $c->creditDate <= $endAt)
                ->sum(static fn ($c) => (float) $c->total);

            $balance = $balanceAt($invoice, $endAt);
            $overdueDays = $invoice->dueAt !== null && $balance > 0
                ? max(0, intdiv($endAt - (int) $invoice->dueAt, self::DAY))
                : 0;

            $rows[] = [
                'id' => (int) $invoice->id,
                'invoiceNumber' => $invoice->invoiceNumber,
                'localAuthorityId' => $invoice->localAuthorityId === null ? null : (int) $invoice->localAuthorityId,
                'invoiceDate' => (int) $invoice->invoiceDate,
                'dueAt' => $invoice->dueAt === null ? null : (int) $invoice->dueAt,
                'purchaseOrderNumber' => $invoice->purchaseOrderNumber,
                'youngPersonReference' => $invoice->youngPersonReferenceSnapshot,
                'status' => $invoice->status,
                'total' => (float) $invoice->total,
                'paid' => round($paidInRange, 2),
                'credited' => round($credited, 2),
                'balance' => $balance,
                'overdueDays' => $overdueDays,
                'agingBucket' => self::agingBucket($balance, $overdueDays),
                'reconciliationStatus' => $invoice->reconciliationStatus,
            ];
        }

        return [
            'startAt' => $startAt,
            'endAt' => $endAt,
            'openingBalance' => round((float) $openingBalance, 2),
            'closingBalance' => round((float) $live->sum(static fn ($row) => $balanceAt($row, $endAt)), 2),
            'rows' => $rows,
        ];
    }

    private static function agingBucket(float $balance, int $overdueDays): string
    {
        if ($balance === 0.0) {
            return 'settled';
        }

        return match (true) {
            $overdueDays === 0 => 'current',
            $overdueDays <= 30 => '1_30',
            $overdueDays <= 60 => '31_60',
            $overdueDays <= 90 => '61_90',
            default => '90_plus',
        };
    }

    /** Sequential per company, zero-padded, so invoice numbers never repeat. */
    public static function formatInvoiceNumber(string $prefix, int $sequence): string
    {
        if (preg_match('/^[A-Z0-9-]{2,12}$/', $prefix) !== 1) {
            throw TrpcException::badRequest('Invalid invoice prefix');
        }
        if ($sequence < 1) {
            throw TrpcException::badRequest('Invalid invoice sequence');
        }

        return $prefix . '-' . str_pad((string) $sequence, 6, '0', STR_PAD_LEFT);
    }

    /** How many billing units a 28-day period holds. */
    public static function periodQuantity(string $billingUnit): int
    {
        return match ($billingUnit) {
            'daily' => 28,
            'weekly' => 4,
            default => 1,
        };
    }
}
