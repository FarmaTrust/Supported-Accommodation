<?php

declare(strict_types=1);

namespace App\Trpc\Routers;

use App\Support\Audit;
use App\Support\Authz;
use App\Support\Crypto;
use App\Support\Dates;
use App\Support\EvidenceStorage;
use App\Support\InvoicePdf;
use App\Support\Rules;
use App\Support\SecureLinks;
use App\Support\StatementPdf;
use App\Support\Statements;
use App\Trpc\Context;
use App\Trpc\Registry;
use App\Trpc\TrpcException;
use App\Trpc\Validate;
use Illuminate\Support\Facades\DB;

/**
 * finance.*, mirroring server/routers/finance.ts.
 *
 * Fee schedules, invoices and their whole life: drafted, approved by somebody
 * else, issued with a number that can never repeat, delivered, paid, credited,
 * disputed and reconciled — with a statement of account over the top.
 *
 * An issued invoice is a legal document. Nothing in here edits one: it is
 * credited, disputed or reissued as a new draft, and the customer, supplier and
 * bank details it carries are snapshots taken at issue rather than live lookups.
 */
final class FinanceRouter
{
    private const BILLING_UNITS = ['daily', 'weekly', 'four_week', 'monthly', 'fixed'];

    private const VAT_TREATMENTS = ['standard', 'reduced', 'zero', 'exempt', 'outside_scope'];

    /** States in which an invoice is out with the customer and can take money. */
    private const PAYABLE = ['issued', 'sent', 'part_paid', 'overdue', 'disputed'];

    public static function register(Registry $registry): void
    {
        $registry->query('finance.feeSchedules', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::read($ctx, $input);

            return DB::table('feeSchedules')->where('entityId', $entityId)->get()
                ->map(static fn ($r) => (array) $r)->all();
        });

        $registry->mutation('finance.createFeeSchedule', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::write($ctx, $input);

            $effectiveFrom = Validate::int($input['effectiveFrom'] ?? null, 'effectiveFrom');
            $effectiveTo = isset($input['effectiveTo']) ? Validate::int($input['effectiveTo'], 'effectiveTo') : null;

            $id = (int) DB::table('feeSchedules')->insertGetId([
                'entityId' => $entityId,
                'localAuthorityId' => Validate::optionalId($input['localAuthorityId'] ?? null, 'localAuthorityId'),
                'propertyId' => Validate::optionalId($input['propertyId'] ?? null, 'propertyId'),
                'placementType' => Validate::optionalString($input['placementType'] ?? null, 'placementType', 120),
                'contractReference' => Validate::optionalString($input['contractReference'] ?? null, 'contractReference', 160),
                'name' => Validate::string($input['name'] ?? null, 'name', 3, 180),
                'billingUnit' => Validate::enum($input['billingUnit'] ?? null, self::BILLING_UNITS, 'billingUnit'),
                'rate' => number_format(Validate::decimal($input['rate'] ?? null, 'rate', 0, 1000000), 2, '.', ''),
                'vatRate' => number_format(Validate::decimal($input['vatRate'] ?? 0, 'vatRate', 0, 100), 2, '.', ''),
                'vatTreatment' => Validate::enum($input['vatTreatment'] ?? null, self::VAT_TREATMENTS, 'vatTreatment'),
                'effectiveFrom' => $effectiveFrom,
                'effectiveTo' => $effectiveTo,
                'status' => 'active',
                'createdBy' => $ctx->userId(),
            ]);

            self::audit($ctx, $entityId, 'fee_schedule.create', 'fee_schedule', $id);

            return ['id' => $id];
        });

        $registry->query('finance.invoices', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::read($ctx, $input);

            // Anything past its due date is marked overdue as the list is read,
            // so the status shown is the status now rather than the status when
            // somebody last touched it.
            DB::table('invoices')
                ->where('entityId', $entityId)
                ->whereIn('status', ['issued', 'sent', 'part_paid'])
                ->where('dueAt', '<', Dates::nowMillis())
                ->update(['status' => 'overdue']);

            return DB::table('invoices')->where('entityId', $entityId)->orderBy('invoiceDate')->get()
                ->map(static fn ($r) => (array) $r)->all();
        });

        $registry->query('finance.invoiceDetail', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::read($ctx, $input);
            $invoiceId = Validate::id($input['invoiceId'] ?? null, 'invoiceId');

            $invoice = DB::table('invoices')->where('id', $invoiceId)->where('entityId', $entityId)->first();
            if ($invoice === null) {
                throw TrpcException::notFound('Invoice not found');
            }

            self::audit($ctx, $entityId, 'invoice.read', 'invoice', $invoiceId, 'allowed');

            return [
                'invoice' => (array) $invoice,
                'lines' => self::rows('invoiceLines', $invoiceId),
                'payments' => self::rows('payments', $invoiceId),
                'credits' => self::rows('creditNotes', $invoiceId),
                'events' => DB::table('invoiceEvents')->where('invoiceId', $invoiceId)
                    ->orderBy('occurredAt')->get()->map(static fn ($r) => (array) $r)->all(),
            ];
        });

        $registry->query('finance.suggestInvoice', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::write($ctx, $input);
            $placementId = Validate::id($input['placementId'] ?? null, 'placementId');
            $periodStart = Validate::int($input['periodStart'] ?? null, 'periodStart');

            $placement = DB::table('placements')->where('id', $placementId)->where('entityId', $entityId)->first();
            if ($placement === null) {
                throw TrpcException::notFound('Placement not found');
            }

            $context = [
                'placement' => (array) $placement,
                'reference' => DB::table('youngPeople')->where('id', $placement->youngPersonId)->value('reference'),
                'authority' => $placement->localAuthorityId === null ? null
                    : (array) DB::table('localAuthorities')->where('id', $placement->localAuthorityId)->first(),
                'property' => $placement->propertyId === null ? null
                    : (array) DB::table('properties')->where('id', $placement->propertyId)->first(),
            ];

            // The most specific fee in force on the period start wins: one tied
            // to this authority, property and placement type beats a general one.
            $fee = DB::table('feeSchedules')
                ->where('entityId', $entityId)->where('status', 'active')
                ->where('effectiveFrom', '<=', $periodStart)
                ->where(fn ($q) => $q->whereNull('effectiveTo')->orWhere('effectiveTo', '>=', $periodStart))
                ->get()
                ->filter(static fn ($f) => ($f->localAuthorityId === null || (int) $f->localAuthorityId === (int) ($placement->localAuthorityId ?? 0))
                    && ($f->propertyId === null || (int) $f->propertyId === (int) ($placement->propertyId ?? 0))
                    && ($f->placementType === null || $f->placementType === $placement->placementBasis))
                ->sortByDesc(static fn ($f) => (int) ($f->localAuthorityId !== null)
                    + (int) ($f->propertyId !== null) + (int) ($f->placementType !== null))
                ->first();

            $periodEnd = $periodStart + 28 * 86400000 - 1;

            if ($fee === null) {
                return ['context' => $context, 'periodEnd' => $periodEnd, 'fee' => null, 'line' => null];
            }

            $quantity = Statements::periodQuantity((string) $fee->billingUnit);

            return [
                'context' => $context,
                'periodEnd' => $periodEnd,
                'fee' => (array) $fee,
                'line' => ['quantity' => $quantity] + Rules::invoiceLine($quantity, (float) $fee->rate, (float) $fee->vatRate),
            ];
        });

        $registry->mutation('finance.createDraft', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::write($ctx, $input);
            $placementId = Validate::id($input['placementId'] ?? null, 'placementId');
            $localAuthorityId = Validate::id($input['localAuthorityId'] ?? null, 'localAuthorityId');
            $periodStart = Validate::int($input['periodStart'] ?? null, 'periodStart');
            $periodEnd = Validate::int($input['periodEnd'] ?? null, 'periodEnd');

            // Billing the same placement twice for the same period is the error
            // an authority notices, so the existing invoice is named instead.
            $duplicate = DB::table('invoices')
                ->where('entityId', $entityId)->where('placementId', $placementId)
                ->where('periodStart', $periodStart)->where('periodEnd', $periodEnd)
                ->first(['id', 'invoiceNumber', 'status']);

            if ($duplicate !== null && $duplicate->status !== 'void') {
                $name = $duplicate->invoiceNumber ?? "draft #$duplicate->id";
                throw TrpcException::conflict(
                    "This placement and fee period already has $name. Open it to correct, credit or reissue rather than creating a duplicate."
                );
            }

            $placement = DB::table('placements')->where('id', $placementId)->where('entityId', $entityId)->first();
            $authority = DB::table('localAuthorities')->where('id', $localAuthorityId)->where('entityId', $entityId)->first();
            $entity = DB::table('entities')->where('id', $entityId)->first();

            if ($placement === null || $authority === null || $entity === null) {
                throw TrpcException::notFound('Invoice context not found');
            }

            $quantity = Validate::decimal($input['quantity'] ?? null, 'quantity', 0.001);
            $unitPrice = Validate::decimal($input['unitPrice'] ?? null, 'unitPrice', 0);
            $vatRate = Validate::decimal($input['vatRate'] ?? null, 'vatRate', 0, 100);
            $totals = Rules::invoiceLine($quantity, $unitPrice, $vatRate);

            $invoiceDate = Validate::int($input['invoiceDate'] ?? null, 'invoiceDate');
            $address = static fn (object $row) => implode(', ', array_filter([
                $row->addressLine1 ?? null, $row->addressLine2 ?? null, $row->city ?? null, $row->postcode ?? null,
            ]));

            $invoiceId = DB::transaction(static function () use ($ctx, $entityId, $localAuthorityId, $placementId, $invoiceDate, $periodStart, $periodEnd, $authority, $entity, $placement, $totals, $quantity, $unitPrice, $vatRate, $address, $input): int {
                $id = (int) DB::table('invoices')->insertGetId([
                    'entityId' => $entityId,
                    'localAuthorityId' => $localAuthorityId,
                    'placementId' => $placementId,
                    'invoiceDate' => $invoiceDate,
                    'periodStart' => $periodStart,
                    'periodEnd' => $periodEnd,
                    'dueAt' => $invoiceDate + (int) $authority->paymentTermsDays * 86400000,
                    'purchaseOrderNumber' => Validate::optionalString($input['purchaseOrderNumber'] ?? null, 'purchaseOrderNumber', 100),
                    // Snapshots, not references: the invoice must keep saying
                    // what it said even if the authority is renamed or the
                    // company moves.
                    'youngPersonReferenceSnapshot' => DB::table('youngPeople')->where('id', $placement->youngPersonId)->value('reference'),
                    'customerNameSnapshot' => $authority->name,
                    'customerAddressSnapshot' => $address($authority),
                    'supplierSnapshot' => json_encode([
                        'name' => $entity->legalName,
                        'address' => $address($entity),
                        'companyNumber' => $entity->companyNumber,
                        'vatNumber' => $entity->vatNumber,
                    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                    'subtotal' => number_format($totals['net'], 2, '.', ''),
                    'vatTotal' => number_format($totals['vat'], 2, '.', ''),
                    'total' => number_format($totals['gross'], 2, '.', ''),
                    'notes' => Validate::optionalString($input['notes'] ?? null, 'notes', 4000),
                    'createdBy' => $ctx->userId(),
                ]);

                DB::table('invoiceLines')->insert([
                    'invoiceId' => $id,
                    'feeScheduleId' => Validate::id($input['feeScheduleId'] ?? null, 'feeScheduleId'),
                    'description' => Validate::string($input['description'] ?? null, 'description', 3, 300),
                    'quantity' => number_format($quantity, 3, '.', ''),
                    'unitPrice' => number_format($unitPrice, 2, '.', ''),
                    'vatRate' => number_format($vatRate, 2, '.', ''),
                    'netAmount' => number_format($totals['net'], 2, '.', ''),
                    'vatAmount' => number_format($totals['vat'], 2, '.', ''),
                    'grossAmount' => number_format($totals['gross'], 2, '.', ''),
                ]);

                self::event($ctx, $entityId, $id, 'created', ['total' => $totals['gross']]);

                return $id;
            });

            self::audit($ctx, $entityId, 'invoice.draft', 'invoice', $invoiceId, 'success', ['total' => $totals['gross']]);

            return ['id' => $invoiceId, 'totals' => $totals];
        });

        $registry->mutation('finance.requestApproval', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::write($ctx, $input);
            $invoice = self::invoice($entityId, Validate::id($input['invoiceId'] ?? null, 'invoiceId'));

            if ($invoice->status !== 'draft') {
                throw TrpcException::conflict('Only a draft can be submitted for approval');
            }

            DB::table('invoices')->where('id', $invoice->id)->update([
                'status' => 'pending_approval',
                'approvalRequestedAt' => Dates::nowMillis(),
                // A resubmission clears any earlier approval, so it cannot be
                // read as applying to the amended invoice.
                'approvedAt' => null,
                'approvedBy' => null,
            ]);

            self::audit($ctx, $entityId, 'invoice.request_approval', 'invoice', (int) $invoice->id);

            return ['success' => true];
        });

        $registry->mutation('finance.approve', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            // Approval needs finance.issue, not finance.write: raising an
            // invoice and approving it are deliberately different permissions.
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'finance.issue');

            $invoice = self::invoice($entityId, Validate::id($input['invoiceId'] ?? null, 'invoiceId'));

            if ($invoice->status !== 'pending_approval') {
                throw TrpcException::conflict('Only a pending invoice can be approved');
            }
            if ((int) $invoice->createdBy === $ctx->userId()) {
                throw TrpcException::forbidden('A different authorised user must approve this invoice');
            }

            $now = Dates::nowMillis();

            DB::transaction(static function () use ($ctx, $entityId, $invoice, $now): void {
                DB::table('invoices')->where('id', $invoice->id)
                    ->update(['approvedAt' => $now, 'approvedBy' => $ctx->userId()]);

                self::event($ctx, $entityId, (int) $invoice->id, 'approved', null, $now);
            });

            self::audit($ctx, $entityId, 'invoice.approve', 'invoice', (int) $invoice->id);

            return ['success' => true];
        });

        $registry->mutation('finance.issue', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'finance.issue');
            $invoiceId = Validate::id($input['invoiceId'] ?? null, 'invoiceId');

            $invoiceNumber = DB::transaction(static function () use ($ctx, $entityId, $invoiceId): string {
                // The company row is locked while its next number is taken, so
                // two invoices issued at once cannot share a number.
                $entity = DB::table('entities')->where('id', $entityId)->lockForUpdate()->first();
                $invoice = DB::table('invoices')->where('id', $invoiceId)->where('entityId', $entityId)->first();

                if ($entity === null || $invoice === null || $invoice->status !== 'pending_approval' || $invoice->approvedAt === null) {
                    throw TrpcException::conflict('The invoice must be independently approved before issue');
                }

                $number = Statements::formatInvoiceNumber((string) $entity->invoicePrefix, (int) $entity->nextInvoiceNumber);

                // The bank details are snapshotted at issue and re-encrypted with
                // the invoice, so changing the company's account later does not
                // rewrite an invoice already sent.
                $bankSnapshot = $entity->bankAccountName ? Crypto::encrypt((string) json_encode([
                    'accountName' => $entity->bankAccountName,
                    'sortCode' => Crypto::decrypt($entity->bankSortCodeCiphertext),
                    'accountNumber' => Crypto::decrypt($entity->bankAccountNumberCiphertext),
                ], JSON_UNESCAPED_SLASHES)) : null;

                DB::table('entities')->where('id', $entity->id)
                    ->update(['nextInvoiceNumber' => (int) $entity->nextInvoiceNumber + 1]);

                DB::table('invoices')->where('id', $invoice->id)->update([
                    'invoiceNumber' => $number,
                    'status' => 'issued',
                    'issuedAt' => Dates::nowMillis(),
                    'issuedBy' => $ctx->userId(),
                    'bankDetailsSnapshotCiphertext' => $bankSnapshot,
                ]);

                self::event($ctx, $entityId, (int) $invoice->id, 'issued', ['invoiceNumber' => $number]);

                return $number;
            });

            self::audit($ctx, $entityId, 'invoice.issue', 'invoice', $invoiceId, 'success', ['invoiceNumber' => $invoiceNumber]);

            return ['invoiceNumber' => $invoiceNumber];
        });

        $registry->mutation('finance.recordPayment', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::write($ctx, $input);
            $invoiceId = Validate::id($input['invoiceId'] ?? null, 'invoiceId');
            $amount = Validate::decimal($input['amount'] ?? null, 'amount', 0.01);
            $receivedAt = Validate::int($input['receivedAt'] ?? null, 'receivedAt');
            $reference = Validate::optionalString($input['reference'] ?? null, 'reference', 160);
            $notes = Validate::optionalString($input['notes'] ?? null, 'notes', 2000);

            $result = DB::transaction(static function () use ($ctx, $entityId, $invoiceId, $amount, $receivedAt, $reference, $notes): array {
                $invoice = DB::table('invoices')->where('id', $invoiceId)->where('entityId', $entityId)
                    ->lockForUpdate()->first();

                if ($invoice === null || !in_array($invoice->status, self::PAYABLE, true)) {
                    throw TrpcException::conflict('Payment cannot be allocated to this invoice state');
                }

                $paymentId = (int) DB::table('payments')->insertGetId([
                    'entityId' => $entityId,
                    'invoiceId' => $invoiceId,
                    'receivedAt' => $receivedAt,
                    'amount' => number_format($amount, 2, '.', ''),
                    'reference' => $reference,
                    'notes' => $notes,
                    'recordedBy' => $ctx->userId(),
                ]);

                // An overpayment does not push the allocated figure past the
                // total; the surplus is a matter for the authority, not a
                // negative balance here.
                $total = (float) $invoice->total;
                $amountPaid = round(min($total, (float) $invoice->amountPaid + $amount), 2);
                $settled = $amountPaid >= $total;

                DB::table('invoices')->where('id', $invoiceId)->update([
                    'amountPaid' => number_format($amountPaid, 2, '.', ''),
                    'status' => $settled ? 'paid' : 'part_paid',
                    'reconciliationStatus' => $settled ? 'reconciled' : 'part_reconciled',
                ]);

                self::event($ctx, $entityId, $invoiceId, 'payment', [
                    'paymentId' => $paymentId, 'amount' => $amount, 'reference' => $reference,
                ], $receivedAt);

                return [
                    'paymentId' => $paymentId,
                    'amountPaid' => $amountPaid,
                    'balance' => round(max(0, $total - $amountPaid), 2),
                ];
            });

            self::audit($ctx, $entityId, 'payment.allocate', 'invoice', $invoiceId, 'success', ['amount' => $amount]);

            return $result;
        });

        $registry->mutation('finance.markDelivered', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::write($ctx, $input);
            $invoice = self::invoice($entityId, Validate::id($input['invoiceId'] ?? null, 'invoiceId'));
            $method = Validate::enum($input['method'] ?? null, ['secure_link', 'email', 'portal', 'manual'], 'method');
            $reference = Validate::string($input['reference'] ?? null, 'reference', 3, 220);

            if (!in_array($invoice->status, ['issued', 'sent', 'part_paid', 'overdue'], true)) {
                throw TrpcException::conflict('Only an issued invoice can be marked delivered');
            }

            $now = Dates::nowMillis();

            DB::transaction(static function () use ($ctx, $entityId, $invoice, $method, $reference, $now): void {
                DB::table('invoices')->where('id', $invoice->id)->update([
                    // Delivery moves issued to sent and leaves any later state
                    // alone: an invoice already part paid does not go backwards.
                    'status' => $invoice->status === 'issued' ? 'sent' : $invoice->status,
                    'sentAt' => $now,
                    'deliveryMethod' => $method,
                    'deliveryReference' => $reference,
                ]);

                self::event($ctx, $entityId, (int) $invoice->id, 'delivered', [
                    'method' => $method, 'reference' => $reference,
                ], $now);
            });

            self::audit($ctx, $entityId, 'invoice.delivered', 'invoice', (int) $invoice->id, 'success', ['method' => $method]);

            return ['success' => true];
        });

        $registry->mutation('finance.setDispute', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::write($ctx, $input);
            $invoice = self::invoice($entityId, Validate::id($input['invoiceId'] ?? null, 'invoiceId'));
            $action = Validate::enum($input['action'] ?? null, ['open', 'resolve'], 'action');
            $notes = Validate::string($input['notes'] ?? null, 'notes', 5, 4000);

            $paid = (float) $invoice->amountPaid;
            $total = (float) $invoice->total;

            // Resolving a dispute returns the invoice to whatever it would have
            // been had it never been disputed, worked out from what was paid.
            $status = $action === 'open' ? 'disputed'
                : ($paid >= $total ? 'paid' : ($paid > 0 ? 'part_paid' : ($invoice->sentAt !== null ? 'sent' : 'issued')));

            $now = Dates::nowMillis();

            DB::transaction(static function () use ($ctx, $entityId, $invoice, $action, $notes, $status, $now): void {
                DB::table('invoices')->where('id', $invoice->id)->update([
                    'status' => $status,
                    'disputeOpenedAt' => $action === 'open' ? $now : $invoice->disputeOpenedAt,
                    'disputeResolvedAt' => $action === 'resolve' ? $now : null,
                    // Notes accumulate rather than overwrite: the history of a
                    // dispute is the record of it.
                    'notes' => implode("\n\n", array_filter([$invoice->notes, $notes])),
                ]);

                self::event($ctx, $entityId, (int) $invoice->id,
                    $action === 'open' ? 'disputed' : 'dispute_resolved', ['notes' => $notes], $now);
            });

            self::audit($ctx, $entityId, "invoice.dispute_$action", 'invoice', (int) $invoice->id);

            return ['success' => true];
        });

        $registry->mutation('finance.issueCredit', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'finance.issue');

            $invoiceId = Validate::id($input['invoiceId'] ?? null, 'invoiceId');
            $netAmount = Validate::decimal($input['netAmount'] ?? null, 'netAmount', 0.01);
            $vatAmount = Validate::decimal($input['vatAmount'] ?? null, 'vatAmount', 0);
            $reason = Validate::string($input['reason'] ?? null, 'reason', 5, 4000);

            $result = DB::transaction(static function () use ($ctx, $entityId, $invoiceId, $netAmount, $vatAmount, $reason): array {
                $invoice = DB::table('invoices')->where('id', $invoiceId)->where('entityId', $entityId)
                    ->lockForUpdate()->first();

                if ($invoice === null || $invoice->invoiceNumber === null
                    || !in_array($invoice->status, ['issued', 'sent', 'part_paid', 'paid', 'overdue', 'disputed'], true)) {
                    throw TrpcException::conflict('An issued invoice is required for a credit note');
                }

                $existing = DB::table('creditNotes')->where('invoiceId', $invoice->id)->get();
                $total = round($netAmount + $vatAmount, 2);
                $previousTotal = $existing->where('status', 'issued')->sum(static fn ($c) => (float) $c->total);

                // Crediting more than was invoiced would turn a correction into
                // a payment to the customer.
                if (round($previousTotal + $total, 2) > (float) $invoice->total) {
                    throw TrpcException::conflict('Credits cannot exceed the original invoice total');
                }

                $creditNumber = 'CR-' . $invoice->invoiceNumber . '-' . str_pad((string) ($existing->count() + 1), 2, '0', STR_PAD_LEFT);
                $now = Dates::nowMillis();

                $creditId = (int) DB::table('creditNotes')->insertGetId([
                    'entityId' => $entityId,
                    'invoiceId' => (int) $invoice->id,
                    'creditNumber' => $creditNumber,
                    'creditDate' => $now,
                    'reason' => $reason,
                    'netAmount' => number_format($netAmount, 2, '.', ''),
                    'vatAmount' => number_format($vatAmount, 2, '.', ''),
                    'total' => number_format($total, 2, '.', ''),
                    'status' => 'issued',
                    'issuedAt' => $now,
                    'issuedBy' => $ctx->userId(),
                    'createdBy' => $ctx->userId(),
                ]);

                $fullyCredited = round($previousTotal + $total, 2) >= (float) $invoice->total;

                DB::table('invoices')->where('id', $invoice->id)->update([
                    'status' => $fullyCredited ? 'credited' : $invoice->status,
                    'reconciliationStatus' => $fullyCredited ? 'reconciled' : 'exception',
                ]);

                self::event($ctx, $entityId, (int) $invoice->id, 'credit', [
                    'creditNoteId' => $creditId, 'creditNumber' => $creditNumber, 'total' => $total,
                ], $now);

                return ['creditId' => $creditId, 'creditNumber' => $creditNumber, 'total' => $total];
            });

            self::audit($ctx, $entityId, 'credit_note.issue', 'invoice', $invoiceId, 'success', [
                'creditNumber' => $result['creditNumber'], 'total' => $result['total'],
            ]);

            return $result;
        });

        $registry->mutation('finance.reissueDraft', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::write($ctx, $input);
            $invoiceId = Validate::id($input['invoiceId'] ?? null, 'invoiceId');
            $invoiceDate = Validate::int($input['invoiceDate'] ?? null, 'invoiceDate');

            $draftId = DB::transaction(static function () use ($ctx, $entityId, $invoiceId, $invoiceDate): int {
                $source = DB::table('invoices')->where('id', $invoiceId)->where('entityId', $entityId)->first();

                // The original is never edited. It has to be credited, disputed
                // or voided first, and the replacement starts as a fresh draft.
                if ($source === null || !in_array($source->status, ['credited', 'disputed', 'void'], true)) {
                    throw TrpcException::conflict('Credit, dispute or void the original before reissuing');
                }

                $id = (int) DB::table('invoices')->insertGetId([
                    'entityId' => (int) $source->entityId,
                    'localAuthorityId' => $source->localAuthorityId,
                    'placementId' => $source->placementId,
                    'invoiceDate' => $invoiceDate,
                    'supplyDate' => $source->supplyDate,
                    'periodStart' => $source->periodStart,
                    'periodEnd' => $source->periodEnd,
                    // The payment terms are carried as a gap rather than a date,
                    // so the reissue is due the same number of days out.
                    'dueAt' => $source->dueAt === null ? null
                        : $invoiceDate + max(0, (int) $source->dueAt - (int) $source->invoiceDate),
                    'purchaseOrderNumber' => $source->purchaseOrderNumber,
                    'youngPersonReferenceSnapshot' => $source->youngPersonReferenceSnapshot,
                    'customerNameSnapshot' => $source->customerNameSnapshot,
                    'customerAddressSnapshot' => $source->customerAddressSnapshot,
                    'supplierSnapshot' => $source->supplierSnapshot,
                    'bankDetailsSnapshotCiphertext' => $source->bankDetailsSnapshotCiphertext,
                    'subtotal' => $source->subtotal,
                    'vatTotal' => $source->vatTotal,
                    'total' => $source->total,
                    'notes' => 'Reissued from ' . ($source->invoiceNumber ?? "draft #$source->id"),
                    'createdBy' => $ctx->userId(),
                ]);

                foreach (DB::table('invoiceLines')->where('invoiceId', $source->id)->get() as $line) {
                    DB::table('invoiceLines')->insert([
                        'invoiceId' => $id,
                        'feeScheduleId' => $line->feeScheduleId,
                        'description' => $line->description,
                        'quantity' => $line->quantity,
                        'unitPrice' => $line->unitPrice,
                        'vatRate' => $line->vatRate,
                        'netAmount' => $line->netAmount,
                        'vatAmount' => $line->vatAmount,
                        'grossAmount' => $line->grossAmount,
                    ]);
                }

                self::event($ctx, $entityId, $id, 'created', ['reissuedFromInvoiceId' => (int) $source->id]);

                return $id;
            });

            self::audit($ctx, $entityId, 'invoice.reissue_draft', 'invoice', $draftId, 'success', ['sourceInvoiceId' => $invoiceId]);

            return ['id' => $draftId];
        });

        $registry->mutation('finance.reconcile', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::write($ctx, $input);
            $invoiceId = Validate::id($input['invoiceId'] ?? null, 'invoiceId');
            $status = Validate::enum($input['status'] ?? null, ['reconciled', 'exception'], 'status');
            $reference = Validate::string($input['reference'] ?? null, 'reference', 3, 220);

            DB::transaction(static function () use ($ctx, $entityId, $invoiceId, $status, $reference): void {
                DB::table('invoices')->where('id', $invoiceId)->where('entityId', $entityId)
                    ->update(['reconciliationStatus' => $status]);

                self::event($ctx, $entityId, $invoiceId, 'reconciled', [
                    'status' => $status, 'reference' => $reference,
                ]);
            });

            self::audit($ctx, $entityId, 'invoice.reconcile', 'invoice', $invoiceId, 'success', ['status' => $status]);

            return ['success' => true];
        });

        $registry->mutation('finance.generatePdf', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::read($ctx, $input);
            $invoice = self::invoice($entityId, Validate::id($input['invoiceId'] ?? null, 'invoiceId'));

            if ($invoice->invoiceNumber === null || $invoice->issuedAt === null) {
                throw TrpcException::conflict('Issue the approved invoice before generating its PDF');
            }

            // A document already generated is returned rather than regenerated,
            // so the file the authority was sent stays the file on record.
            if ($invoice->pdfDocumentId !== null) {
                $version = DB::table('documentVersions')->where('documentId', $invoice->pdfDocumentId)->first();
                if ($version !== null && $version->fileUrl !== null) {
                    return ['documentId' => (int) $invoice->pdfDocumentId, 'url' => $version->fileUrl, 'existing' => true];
                }
            }

            $supplier = is_string($invoice->supplierSnapshot)
                ? json_decode($invoice->supplierSnapshot, true)
                : ($invoice->supplierSnapshot ?? []);

            $bank = $invoice->bankDetailsSnapshotCiphertext === null ? null
                : json_decode((string) Crypto::decrypt($invoice->bankDetailsSnapshotCiphertext), true);

            $bytes = InvoicePdf::render([
                'invoiceNumber' => $invoice->invoiceNumber,
                'invoiceDate' => (int) $invoice->invoiceDate,
                'dueAt' => $invoice->dueAt === null ? null : (int) $invoice->dueAt,
                'purchaseOrderNumber' => $invoice->purchaseOrderNumber,
                'supplier' => is_array($supplier) ? $supplier : [],
                'customerName' => $invoice->customerNameSnapshot,
                'customerAddress' => $invoice->customerAddressSnapshot,
                'placementReference' => $invoice->youngPersonReferenceSnapshot,
                'periodStart' => (int) $invoice->periodStart,
                'periodEnd' => (int) $invoice->periodEnd,
                'lines' => self::rows('invoiceLines', (int) $invoice->id),
                'subtotal' => (float) $invoice->subtotal,
                'vatTotal' => (float) $invoice->vatTotal,
                'total' => (float) $invoice->total,
                'bank' => $bank,
            ]);

            $stored = EvidenceStorage::putBytes(
                sprintf('entities/%d/invoices/%d', $entityId, (int) $invoice->id),
                $invoice->invoiceNumber . '.pdf',
                'application/pdf',
                $bytes,
            );

            $documentId = DB::transaction(static function () use ($ctx, $entityId, $invoice, $stored): int {
                $id = (int) DB::table('documents')->insertGetId([
                    'entityId' => $entityId,
                    'title' => 'Invoice ' . $invoice->invoiceNumber,
                    'documentType' => 'generated',
                    'classification' => 'finance',
                    // Generated from an already-approved invoice, so the document
                    // needs no separate review.
                    'status' => 'approved',
                    'currentVersion' => 1,
                    'retentionBasis' => 'Finance and VAT record retention policy',
                    'createdBy' => $ctx->userId(),
                ]);

                DB::table('documentVersions')->insert([
                    'documentId' => $id,
                    'version' => 1,
                    'fileKey' => $stored['key'],
                    'fileUrl' => $stored['url'],
                    'fileName' => $stored['fileName'],
                    'mimeType' => 'application/pdf',
                    'sizeBytes' => $stored['sizeBytes'],
                    'contentHash' => $stored['contentHash'],
                    'scanStatus' => 'clean',
                    'approvedAt' => Dates::nowMillis(),
                    'approvedBy' => $ctx->userId(),
                    'createdBy' => $ctx->userId(),
                ]);

                DB::table('invoices')->where('id', $invoice->id)->update(['pdfDocumentId' => $id]);

                self::event($ctx, $entityId, (int) $invoice->id, 'document_generated', [
                    'documentId' => $id, 'contentHash' => $stored['contentHash'],
                ]);

                return $id;
            });

            self::audit($ctx, $entityId, 'invoice.pdf_generate', 'invoice', (int) $invoice->id, 'success', [
                'documentId' => $documentId, 'contentHash' => $stored['contentHash'],
            ]);

            return ['documentId' => $documentId, 'url' => $stored['url'], 'existing' => false];
        });

        $registry->mutation('finance.createSecureLink', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::write($ctx, $input);
            $invoice = self::invoice($entityId, Validate::id($input['invoiceId'] ?? null, 'invoiceId'));

            if ($invoice->pdfDocumentId === null) {
                throw TrpcException::conflict('Generate the invoice PDF before creating a secure link');
            }

            $expiresInDays = Validate::int($input['expiresInDays'] ?? 7, 'expiresInDays', 1, 30);
            $maxViews = Validate::int($input['maxViews'] ?? 5, 'maxViews', 1, 50);
            $expiresAt = Dates::nowMillis() + $expiresInDays * 86400000;
            $token = SecureLinks::createToken();

            $linkId = DB::transaction(static function () use ($ctx, $entityId, $invoice, $token, $expiresAt, $maxViews, $input): int {
                $id = (int) DB::table('secureLinks')->insertGetId([
                    'entityId' => $entityId,
                    'invoiceId' => (int) $invoice->id,
                    'documentId' => (int) $invoice->pdfDocumentId,
                    'tokenHash' => SecureLinks::hashToken($token),
                    'recipientEmail' => ($input['recipientEmail'] ?? '') === '' ? null : Validate::email($input['recipientEmail']),
                    'expiresAt' => $expiresAt,
                    'maxViews' => $maxViews,
                    'createdBy' => $ctx->userId(),
                ]);

                self::event($ctx, $entityId, (int) $invoice->id, 'secure_link_created', [
                    'secureLinkId' => $id,
                    'recipientEmail' => $input['recipientEmail'] ?? null,
                    'expiresAt' => $expiresAt,
                    'maxViews' => $maxViews,
                ]);

                return $id;
            });

            self::audit($ctx, $entityId, 'invoice.secure_link_create', 'invoice', (int) $invoice->id, 'success', [
                'secureLinkId' => $linkId, 'expiresAt' => $expiresAt,
            ]);

            return ['id' => $linkId, 'url' => "/invoice-share/$token", 'expiresAt' => $expiresAt];
        });

        $registry->query('finance.secureLinks', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::read($ctx, $input);

            return DB::table('secureLinks')
                ->where('entityId', $entityId)
                ->where('invoiceId', Validate::id($input['invoiceId'] ?? null, 'invoiceId'))
                ->orderBy('createdAt')->get()
                // The hash is not shown: it is the only thing standing between
                // the stored row and a working link.
                ->map(static function ($row): array {
                    $link = (array) $row;
                    unset($link['tokenHash']);

                    return $link;
                })->all();
        });

        $registry->mutation('finance.revokeSecureLink', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::write($ctx, $input);
            $id = Validate::id($input['id'] ?? null, 'id');

            $link = DB::table('secureLinks')->where('id', $id)->where('entityId', $entityId)->first();
            if ($link === null || $link->invoiceId === null) {
                throw TrpcException::notFound('Invoice delivery link not found');
            }

            DB::transaction(static function () use ($ctx, $entityId, $link): void {
                DB::table('secureLinks')->where('id', $link->id)->update(['revokedAt' => Dates::nowMillis()]);

                self::event($ctx, $entityId, (int) $link->invoiceId, 'secure_link_revoked', [
                    'secureLinkId' => (int) $link->id,
                ]);
            });

            self::audit($ctx, $entityId, 'invoice.secure_link_revoke', 'invoice', (int) $link->invoiceId, 'success', [
                'secureLinkId' => (int) $link->id,
            ]);

            return ['success' => true];
        });

        // Public: the authority reading an invoice has no account, so the link
        // is the credential and every limit on it is enforced below.
        $registry->query('finance.resolveSecureLink', Registry::PUBLIC, static function (Context $ctx, mixed $input): array {
            $token = Validate::token(
                $input['token'] ?? null,
                'This invoice link is invalid, expired, revoked or has reached its view limit',
                20,
                200,
            );

            $unavailable = static fn (): TrpcException => TrpcException::notFound(
                'This invoice link is invalid, expired, revoked or has reached its view limit'
            );

            $result = DB::transaction(static function () use ($token, $unavailable): array {
                $link = DB::table('secureLinks')->where('tokenHash', SecureLinks::hashToken($token))
                    ->lockForUpdate()->first();

                if ($link === null || $link->invoiceId === null || $link->documentId === null
                    || !SecureLinks::isUsable($link)) {
                    throw $unavailable();
                }

                $invoice = DB::table('invoices')->where('id', $link->invoiceId)->first();
                $version = DB::table('documentVersions')->where('documentId', $link->documentId)->first();

                if ($invoice === null || $version === null || $version->fileUrl === null) {
                    throw TrpcException::notFound('Invoice document is unavailable');
                }

                $now = Dates::nowMillis();

                DB::table('secureLinks')->where('id', $link->id)->update([
                    'viewCount' => (int) $link->viewCount + 1,
                    'lastViewedAt' => $now,
                ]);

                DB::table('invoiceEvents')->insert([
                    'entityId' => (int) $link->entityId,
                    'invoiceId' => (int) $invoice->id,
                    'eventType' => 'secure_link_viewed',
                    'occurredAt' => $now,
                    'metadata' => json_encode([
                        'secureLinkId' => (int) $link->id, 'view' => (int) $link->viewCount + 1,
                    ], JSON_UNESCAPED_SLASHES),
                ]);

                return [
                    'linkId' => (int) $link->id,
                    'entityId' => (int) $link->entityId,
                    // Only what the invoice itself shows; nothing about the
                    // placement beyond the reference already printed on it.
                    'invoice' => [
                        'invoiceNumber' => $invoice->invoiceNumber,
                        'invoiceDate' => (int) $invoice->invoiceDate,
                        'dueAt' => $invoice->dueAt === null ? null : (int) $invoice->dueAt,
                        'customerName' => $invoice->customerNameSnapshot,
                        'reference' => $invoice->youngPersonReferenceSnapshot,
                        'periodStart' => (int) $invoice->periodStart,
                        'periodEnd' => (int) $invoice->periodEnd,
                        'total' => (float) $invoice->total,
                        'status' => $invoice->status,
                    ],
                    'fileUrl' => $version->fileUrl,
                    'expiresAt' => (int) $link->expiresAt,
                    'remainingViews' => $link->maxViews === null ? null
                        : max(0, (int) $link->maxViews - (int) $link->viewCount - 1),
                ];
            });

            Audit::write([
                'actorType' => 'secure_link',
                'entityId' => $result['entityId'],
                'action' => 'invoice.secure_link_view',
                'resourceType' => 'invoice',
                'resourceId' => $result['invoice']['invoiceNumber'],
                'sensitivity' => 'finance',
                'result' => 'allowed',
                'metadata' => ['secureLinkId' => $result['linkId']],
            ]);

            return $result;
        });

        $registry->mutation('finance.generateStatementPdf', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::read($ctx, $input);
            $localAuthorityId = Validate::optionalId($input['localAuthorityId'] ?? null, 'localAuthorityId');
            $startAt = Validate::int($input['startAt'] ?? null, 'startAt');
            $endAt = Validate::int($input['endAt'] ?? null, 'endAt');

            $statement = Statements::calculate($entityId, $localAuthorityId, $startAt, $endAt);

            $entity = DB::table('entities')->where('id', $entityId)->first();
            if ($entity === null) {
                throw TrpcException::notFound('The selected company could not be found.');
            }

            $authority = null;
            if ($localAuthorityId !== null) {
                $authority = DB::table('localAuthorities')->where('id', $localAuthorityId)
                    ->where('entityId', $entityId)->first();

                if ($authority === null) {
                    throw TrpcException::forbidden('The selected Local Authority does not belong to this company.');
                }
            }

            $authorityName = $authority->name ?? 'All authorised Local Authorities';

            $bytes = StatementPdf::render([
                'entityName' => $entity->legalName,
                'authorityName' => $authorityName,
                'startAt' => $statement['startAt'],
                'endAt' => $statement['endAt'],
                'openingBalance' => $statement['openingBalance'],
                'closingBalance' => $statement['closingBalance'],
                'rows' => $statement['rows'],
            ]);

            $stored = EvidenceStorage::putBytes(
                "entities/$entityId/statements",
                sprintf('statement-%d-%d.pdf', $startAt, $endAt),
                'application/pdf',
                $bytes,
            );

            $title = 'Statement of account — ' . $authorityName . ' — '
                . \App\Support\Pdf::date($startAt) . ' to ' . \App\Support\Pdf::date($endAt);

            $archive = DB::transaction(static function () use ($ctx, $entityId, $localAuthorityId, $statement, $stored, $title): array {
                $documentId = (int) DB::table('documents')->insertGetId([
                    'entityId' => $entityId,
                    'title' => $title,
                    'documentType' => 'generated',
                    'classification' => 'finance',
                    'status' => 'approved',
                    'currentVersion' => 1,
                    'retentionBasis' => 'Finance and VAT record retention policy',
                    'createdBy' => $ctx->userId(),
                ]);

                DB::table('documentVersions')->insert([
                    'documentId' => $documentId,
                    'version' => 1,
                    'fileKey' => $stored['key'],
                    'fileUrl' => $stored['url'],
                    'fileName' => $stored['fileName'],
                    'mimeType' => 'application/pdf',
                    'sizeBytes' => $stored['sizeBytes'],
                    'contentHash' => $stored['contentHash'],
                    'scanStatus' => 'clean',
                    'approvedAt' => Dates::nowMillis(),
                    'approvedBy' => $ctx->userId(),
                    'createdBy' => $ctx->userId(),
                ]);

                // The archive records the hash of what was produced, so a
                // statement sent to an authority can be shown to be the one on
                // file.
                $archiveId = (int) DB::table('statementArchives')->insertGetId([
                    'entityId' => $entityId,
                    'localAuthorityId' => $localAuthorityId,
                    'documentId' => $documentId,
                    'generatedBy' => $ctx->userId(),
                    'startAt' => $statement['startAt'],
                    'endAt' => $statement['endAt'],
                    'openingBalance' => number_format($statement['openingBalance'], 2, '.', ''),
                    'closingBalance' => number_format($statement['closingBalance'], 2, '.', ''),
                    'contentHash' => $stored['contentHash'],
                ]);

                return ['id' => $archiveId, 'documentId' => $documentId];
            });

            self::audit($ctx, $entityId, 'finance.statement.pdf_generate', 'statement_archive', $archive['id'], 'success', [
                'documentId' => $archive['documentId'],
                'localAuthorityId' => $localAuthorityId,
                'startAt' => $startAt,
                'endAt' => $endAt,
                'contentHash' => $stored['contentHash'],
            ]);

            return $archive + ['url' => $stored['url'], 'contentHash' => $stored['contentHash']];
        });

        $registry->query('finance.statementArchive', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::read($ctx, $input);
            $localAuthorityId = Validate::optionalId($input['localAuthorityId'] ?? null, 'localAuthorityId');
            $startAt = isset($input['startAt']) ? Validate::int($input['startAt'], 'startAt') : null;
            $endAt = isset($input['endAt']) ? Validate::int($input['endAt'], 'endAt') : null;

            $query = DB::table('statementArchives as a')
                ->join('documents as d', 'd.id', '=', 'a.documentId')
                ->join('documentVersions as v', 'v.documentId', '=', 'd.id')
                ->leftJoin('localAuthorities as la', 'la.id', '=', 'a.localAuthorityId')
                ->where('a.entityId', $entityId);

            if ($localAuthorityId !== null) {
                $query->where('a.localAuthorityId', $localAuthorityId);
            }
            // Overlap, not containment: a statement that straddles the requested
            // window is still about it.
            if ($startAt !== null) {
                $query->where('a.endAt', '>=', $startAt);
            }
            if ($endAt !== null) {
                $query->where('a.startAt', '<=', $endAt);
            }

            $rows = $query->orderByDesc('a.createdAt')->limit(100)
                ->select([
                    'a.*', 'd.title', 'v.fileUrl', 'v.fileName', 'la.name as authorityName',
                ])->get();

            self::audit($ctx, $entityId, 'finance.statement_archive.read', 'statement_archive', 0, 'allowed', [
                'localAuthorityId' => $localAuthorityId,
            ]);

            return $rows->map(static fn ($row) => [
                'id' => (int) $row->id,
                'localAuthorityId' => $row->localAuthorityId === null ? null : (int) $row->localAuthorityId,
                'authorityName' => $row->authorityName ?? 'All authorised Local Authorities',
                'documentId' => (int) $row->documentId,
                'title' => $row->title,
                'startAt' => (int) $row->startAt,
                'endAt' => (int) $row->endAt,
                'openingBalance' => (float) $row->openingBalance,
                'closingBalance' => (float) $row->closingBalance,
                'contentHash' => $row->contentHash,
                'createdAt' => Dates::fromDatabase($row->createdAt),
                'url' => $row->fileUrl,
                'fileName' => $row->fileName,
            ])->all();
        });

        $registry->query('finance.statement', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::read($ctx, $input);
            $localAuthorityId = Validate::optionalId($input['localAuthorityId'] ?? null, 'localAuthorityId');

            $now = Dates::nowMillis();
            $endAt = isset($input['endAt']) ? Validate::int($input['endAt'], 'endAt') : $now;
            $startAt = isset($input['startAt']) ? Validate::int($input['startAt'], 'startAt') : $endAt - 365 * 86400000;

            $statement = Statements::calculate($entityId, $localAuthorityId, $startAt, $endAt);

            self::audit($ctx, $entityId, 'finance.statement.read', 'statement', 0, 'allowed', [
                'localAuthorityId' => $localAuthorityId, 'startAt' => $startAt, 'endAt' => $endAt,
            ]);

            return $statement;
        });
    }

    private static function read(Context $ctx, mixed $input): int
    {
        $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
        Authz::assertEntityCapability($ctx->userId(), $entityId, 'finance.read');

        return $entityId;
    }

    private static function write(Context $ctx, mixed $input): int
    {
        $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
        Authz::assertEntityCapability($ctx->userId(), $entityId, 'finance.write');

        return $entityId;
    }

    private static function invoice(int $entityId, int $invoiceId): object
    {
        $invoice = DB::table('invoices')->where('id', $invoiceId)->where('entityId', $entityId)->first();
        if ($invoice === null) {
            throw TrpcException::notFound('Invoice not found');
        }

        return $invoice;
    }

    /** @return array<int, array<string, mixed>> */
    private static function rows(string $table, int $invoiceId): array
    {
        return DB::table($table)->where('invoiceId', $invoiceId)->get()
            ->map(static fn ($r) => (array) $r)->all();
    }

    /**
     * An invoice carries its own event log beside the audit trail: the trail
     * answers who did what, the log is the invoice's own history, and a
     * customer query is answered from it.
     *
     * @param array<string, mixed>|null $metadata
     */
    private static function event(Context $ctx, int $entityId, int $invoiceId, string $eventType, ?array $metadata = null, ?int $occurredAt = null): void
    {
        DB::table('invoiceEvents')->insert([
            'entityId' => $entityId,
            'invoiceId' => $invoiceId,
            'eventType' => $eventType,
            'occurredAt' => $occurredAt ?? Dates::nowMillis(),
            'actorUserId' => $ctx->userId(),
            'metadata' => $metadata === null ? null : json_encode($metadata, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
        ]);
    }

    /** @param array<string, mixed>|null $metadata */
    private static function audit(Context $ctx, int $entityId, string $action, string $resourceType, int $resourceId, string $result = 'success', ?array $metadata = null): void
    {
        Audit::write(array_filter([
            'actorUserId' => $ctx->userId(),
            'entityId' => $entityId,
            'action' => $action,
            'resourceType' => $resourceType,
            'resourceId' => $resourceId === 0 ? null : $resourceId,
            'sensitivity' => 'finance',
            'result' => $result,
            'metadata' => $metadata,
        ], static fn ($value) => $value !== null));
    }
}
