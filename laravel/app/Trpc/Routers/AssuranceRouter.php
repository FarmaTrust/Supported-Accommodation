<?php

declare(strict_types=1);

namespace App\Trpc\Routers;

use App\Support\AssuranceRules;
use App\Support\Audit;
use App\Support\Authz;
use App\Support\Dates;
use App\Support\EvidenceStorage;
use App\Trpc\Context;
use App\Trpc\Registry;
use App\Trpc\TrpcException;
use App\Trpc\Validate;
use Illuminate\Support\Facades\DB;

/**
 * assurance.*, mirroring server/routers/assurance.ts.
 *
 * The checks the service runs on itself: who can sign in and how that was
 * assured, whether uploaded files were scanned, whether backups and restores
 * actually work, and whether the audit trail is still intact.
 */
final class AssuranceRouter
{
    private const DAY_MS = 86400000;

    private const ASSURANCE_TYPES = [
        'mfa', 'sso', 'account_recovery', 'role_sign_off', 'access_review', 'break_glass', 'joiner_mover_leaver',
    ];
    private const ASSURANCE_DECISIONS = ['passed', 'conditional', 'failed', 'revoked', 'expired'];

    private const CHECK_TYPES = [
        'backup', 'restore', 'database', 'object_storage', 'notification',
        'integration', 'scheduled_job', 'audit_chain', 'security_monitoring',
    ];
    private const CHECK_OUTCOMES = ['passed', 'warning', 'failed', 'waived'];

    public static function register(Registry $registry): void
    {
        $registry->query('assurance.workspace', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'audit.read');

            $receipts = DB::table('auditReceiptMirrors')->where('entityId', $entityId)->get(['status']);

            $stored = 0;
            $warning = 0;
            foreach ($receipts as $receipt) {
                if ($receipt->status === 'stored' || $receipt->status === 'verified') {
                    $stored++;
                } elseif ($receipt->status === 'missing' || $receipt->status === 'mismatch') {
                    $warning++;
                }
            }

            $byEntity = static fn (string $table, string $order) => DB::table($table)
                ->where('entityId', $entityId)->orderByDesc($order)
                ->get()->map(static fn ($r) => (array) $r)->all();

            return [
                'identity' => $byEntity('identityAssuranceReviews', 'createdAt'),
                'scans' => $byEntity('documentScanJobs', 'createdAt'),
                'resilience' => $byEntity('resilienceChecks', 'createdAt'),
                'verification' => $byEntity('auditVerificationRuns', 'startedAt'),
                // The receipts themselves are a long list of hashes; the
                // workspace only needs to know whether any are in trouble.
                'receiptHealth' => ['stored' => $stored, 'warning' => $warning],
            ];
        });

        $registry->mutation('assurance.createIdentityReview', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::assertConfigWriter($ctx, $input);

            $id = (int) DB::table('identityAssuranceReviews')->insertGetId([
                'entityId' => $entityId,
                'userId' => Validate::optionalId($input['userId'] ?? null, 'userId'),
                'assuranceType' => Validate::enum($input['assuranceType'] ?? null, self::ASSURANCE_TYPES, 'assuranceType'),
                'provider' => Validate::optionalString($input['provider'] ?? null, 'provider', 160),
                'assuranceMethod' => Validate::optionalString($input['assuranceMethod'] ?? null, 'assuranceMethod', 220),
                'nextReviewAt' => Validate::optionalInt($input['nextReviewAt'] ?? null, 'nextReviewAt'),
                'riskNotes' => Validate::optionalString($input['riskNotes'] ?? null, 'riskNotes', 4000),
                'createdBy' => $ctx->userId(),
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'identity_assurance.created',
                'resourceType' => 'identity_assurance_review',
                'resourceId' => $id,
                'sensitivity' => 'restricted',
                'result' => 'success',
            ]);

            return ['id' => $id];
        });

        $registry->mutation('assurance.decideIdentityReview', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::assertConfigWriter($ctx, $input);
            $row = self::findOwned('identityAssuranceReviews', $input['reviewId'] ?? null, 'reviewId', $entityId, 'Identity assurance review not found');

            // This review is about who may get into the system, so the person
            // who raised it does not also decide it.
            if ((int) $row->createdBy === $ctx->userId()) {
                throw TrpcException::forbidden('A different authorised user must approve the identity assurance review');
            }

            $status = Validate::enum($input['status'] ?? null, self::ASSURANCE_DECISIONS, 'status');
            $now = Dates::nowMillis();

            DB::table('identityAssuranceReviews')->where('id', $row->id)->update([
                'status' => $status,
                'decisionNotes' => Validate::string($input['decisionNotes'] ?? null, 'decisionNotes', 5, 4000),
                'nextReviewAt' => Validate::optionalInt($input['nextReviewAt'] ?? null, 'nextReviewAt'),
                'reviewedAt' => $now,
                'reviewedBy' => $ctx->userId(),
                'approvedBy' => $ctx->userId(),
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'identity_assurance.decided',
                'resourceType' => 'identity_assurance_review',
                'resourceId' => (int) $row->id,
                'sensitivity' => 'restricted',
                'result' => 'success',
                'metadata' => ['status' => $status],
            ]);

            return ['success' => true];
        });

        $registry->mutation('assurance.overrideScan', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::assertDocumentWriter($ctx, $input);
            $row = self::findOwned('documentScanJobs', $input['scanJobId'] ?? null, 'scanJobId', $entityId, 'Document scan job not found');

            if (!in_array($row->status, ['quarantined', 'failed'], true)) {
                throw TrpcException::badRequest('Only quarantined or failed scans can be overridden');
            }

            // Releasing a quarantined file is a decision somebody owns, so the
            // reason has to be long enough to be an explanation.
            DB::table('documentScanJobs')->where('id', $row->id)->update([
                'status' => 'overridden',
                'overrideReason' => Validate::string($input['overrideReason'] ?? null, 'overrideReason', 20, 4000),
                'overriddenBy' => $ctx->userId(),
                'completedAt' => Dates::nowMillis(),
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'document_scan.overridden',
                'resourceType' => 'document_scan_job',
                'resourceId' => (int) $row->id,
                'sensitivity' => 'restricted',
                'result' => 'success',
            ]);

            return ['success' => true];
        });

        $registry->mutation('assurance.retryScan', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::assertDocumentWriter($ctx, $input);
            $row = self::findOwned('documentScanJobs', $input['scanJobId'] ?? null, 'scanJobId', $entityId, 'Document scan job not found');

            if (!AssuranceRules::scanRetryAllowed((string) $row->status)) {
                throw TrpcException::badRequest('Only failed or quarantined scan jobs can be resubmitted');
            }

            $now = Dates::nowMillis();

            // A resubmission starts clean: the earlier verdict, threat name and
            // any override are cleared so the new result stands on its own.
            DB::table('documentScanJobs')->where('id', $row->id)->update([
                'status' => 'queued',
                'attempts' => (int) $row->attempts + 1,
                'lastAttemptAt' => $now,
                'nextRetryAt' => $now,
                'completedAt' => null,
                'verdict' => null,
                'threatName' => null,
                'overrideReason' => null,
                'overriddenBy' => null,
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'document_scan.resubmitted',
                'resourceType' => 'document_scan_job',
                'resourceId' => (int) $row->id,
                'sensitivity' => 'restricted',
                'result' => 'success',
            ]);

            return ['success' => true];
        });

        $registry->mutation('assurance.createResilienceCheck', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::assertConfigWriter($ctx, $input);

            $id = (int) DB::table('resilienceChecks')->insertGetId([
                'entityId' => $entityId,
                'checkType' => Validate::enum($input['checkType'] ?? null, self::CHECK_TYPES, 'checkType'),
                'title' => Validate::string($input['title'] ?? null, 'title', 3, 220),
                'frequencyDays' => Validate::optionalInt($input['frequencyDays'] ?? null, 'frequencyDays', 1, 3650),
                'ownerUserId' => Validate::optionalId($input['ownerUserId'] ?? null, 'ownerUserId'),
                'nextDueAt' => Validate::optionalInt($input['nextDueAt'] ?? null, 'nextDueAt'),
                'createdBy' => $ctx->userId(),
            ]);

            return ['id' => $id];
        });

        $registry->mutation('assurance.completeResilienceCheck', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::assertConfigWriter($ctx, $input);
            $row = self::findOwned('resilienceChecks', $input['checkId'] ?? null, 'checkId', $entityId, 'Resilience check not found');

            $status = Validate::enum($input['status'] ?? null, self::CHECK_OUTCOMES, 'status');
            $resultSummary = Validate::string($input['resultSummary'] ?? null, 'resultSummary', 5, 5000);
            $durationMs = Validate::optionalInt($input['durationMs'] ?? null, 'durationMs', 0);
            $createCorrectiveAction = Validate::bool($input['createCorrectiveAction'] ?? null, 'createCorrectiveAction', true);

            $now = Dates::nowMillis();
            $correctiveWorkPlanId = $row->correctiveWorkPlanId === null ? null : (int) $row->correctiveWorkPlanId;

            DB::transaction(static function () use (
                $ctx, $entityId, $row, $status, $resultSummary, $durationMs, $createCorrectiveAction, $now, &$correctiveWorkPlanId
            ): void {
                // A check that did not pass raises the work to fix it, once. A
                // failure is given three days and a warning a fortnight, so the
                // due date reflects how bad the finding was.
                if (in_array($status, ['failed', 'warning'], true)
                    && $createCorrectiveAction
                    && $correctiveWorkPlanId === null) {
                    $correctiveWorkPlanId = (int) DB::table('workPlanActions')->insertGetId([
                        'entityId' => $entityId,
                        'title' => 'Resolve ' . $row->title,
                        'description' => $resultSummary,
                        'sourceType' => 'manual',
                        'sourceId' => (int) $row->id,
                        'ownerUserId' => $row->ownerUserId === null ? null : (int) $row->ownerUserId,
                        'priority' => $status === 'failed' ? 'critical' : 'high',
                        'dueAt' => $now + ($status === 'failed' ? 3 : 14) * self::DAY_MS,
                        'status' => 'open',
                        'createdBy' => $ctx->userId(),
                    ]);
                }

                DB::table('resilienceChecks')->where('id', $row->id)->update([
                    'status' => $status,
                    'resultSummary' => $resultSummary,
                    'durationMs' => $durationMs,
                    'lastCheckedAt' => $now,
                    // A check with a cadence books its own next run.
                    'nextDueAt' => $row->frequencyDays === null ? null : $now + (int) $row->frequencyDays * self::DAY_MS,
                    'correctiveWorkPlanId' => $correctiveWorkPlanId,
                    'completedBy' => $ctx->userId(),
                ]);
            });

            return ['success' => true, 'correctiveWorkPlanId' => $correctiveWorkPlanId];
        });

        $registry->mutation('assurance.verifyAuditChain', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'audit.read');

            // The chain is one sequence across every company, so it is walked
            // whole. Only the receipt check is narrowed to this company's rows.
            $events = DB::table('auditLogs')->orderBy('id')
                ->get(['id', 'entityId', 'previousHash', 'eventHash']);

            $chainMismatches = 0;
            $expected = null;
            foreach ($events as $event) {
                if ($event->eventHash === null || $event->previousHash !== $expected) {
                    $chainMismatches++;
                }
                $expected = $event->eventHash;
            }

            $receiptByEvent = [];
            foreach (DB::table('auditReceiptMirrors')->get(['id', 'auditEventId', 'storageKey']) as $receipt) {
                $receiptByEvent[(int) $receipt->auditEventId] = $receipt;
            }

            $scoped = 0;
            $missingReceipts = 0;
            $verifiedReceipts = 0;
            $mismatchedReceipts = 0;
            $now = Dates::nowMillis();

            foreach ($events as $event) {
                if ((int) ($event->entityId ?? 0) !== $entityId) {
                    continue;
                }
                $scoped++;

                $receipt = $receiptByEvent[(int) $event->id] ?? null;
                if ($receipt === null) {
                    $missingReceipts++;

                    continue;
                }

                $body = EvidenceStorage::read((string) $receipt->storageKey);
                $status = $body === null
                    ? 'missing'
                    : AssuranceRules::auditReceiptBodyStatus(
                        json_decode($body, true),
                        (int) $event->id,
                        (string) ($event->eventHash ?? ''),
                    );

                match ($status) {
                    'verified' => $verifiedReceipts++,
                    'missing' => $missingReceipts++,
                    default => $mismatchedReceipts++,
                };

                DB::table('auditReceiptMirrors')->where('id', $receipt->id)
                    ->update(['status' => $status, 'lastVerifiedAt' => $now]);
            }

            $receiptIssues = $missingReceipts + $mismatchedReceipts;
            // A broken link is tampering; a missing receipt is a warning. They
            // are not the same finding and do not get the same status.
            $status = $chainMismatches > 0 ? 'failed' : ($receiptIssues > 0 ? 'warning' : 'passed');

            $first = $events->first();
            $last = $events->last();

            $id = (int) DB::table('auditVerificationRuns')->insertGetId([
                'entityId' => $entityId,
                'rangeStartId' => $first === null ? null : (int) $first->id,
                'rangeEndId' => $last === null ? null : (int) $last->id,
                'checkedEvents' => $events->count(),
                'chainMismatches' => $chainMismatches,
                'missingReceipts' => $receiptIssues,
                'status' => $status,
                'summary' => sprintf(
                    'Verified %d linked audit events and %d object receipts; %d link mismatches, %d missing and %d mismatched receipts.',
                    $events->count(), $verifiedReceipts, $chainMismatches, $missingReceipts, $mismatchedReceipts,
                ),
                'manifest' => json_encode([
                    'scope' => 'global_chain_entity_object_receipts',
                    'entityEvents' => $scoped,
                    'verifiedReceipts' => $verifiedReceipts,
                    'missingReceipts' => $missingReceipts,
                    'mismatchedReceipts' => $mismatchedReceipts,
                ], JSON_UNESCAPED_SLASHES),
                'startedAt' => $now,
                'completedAt' => Dates::nowMillis(),
                'createdBy' => $ctx->userId(),
            ]);

            return [
                'id' => $id,
                'status' => $status,
                'checkedEvents' => $events->count(),
                'chainMismatches' => $chainMismatches,
                'missingReceipts' => $receiptIssues,
                'verifiedReceipts' => $verifiedReceipts,
                'mismatchedReceipts' => $mismatchedReceipts,
            ];
        });
    }

    private static function assertConfigWriter(Context $ctx, mixed $input): int
    {
        $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
        Authz::assertEntityCapability($ctx->userId(), $entityId, 'config.write');

        return $entityId;
    }

    private static function assertDocumentWriter(Context $ctx, mixed $input): int
    {
        $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
        Authz::assertEntityCapability($ctx->userId(), $entityId, 'document.write');

        return $entityId;
    }

    /** A record named in the request, confirmed to belong to this company. */
    private static function findOwned(string $table, mixed $id, string $field, int $entityId, string $missing): object
    {
        $row = DB::table($table)
            ->where('id', Validate::id($id, $field))
            ->where('entityId', $entityId)
            ->first();

        if ($row === null) {
            throw TrpcException::notFound($missing);
        }

        return $row;
    }
}
