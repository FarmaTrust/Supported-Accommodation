<?php

declare(strict_types=1);

namespace App\Trpc\Routers;

use App\Support\Audit;
use App\Support\Authz;
use App\Support\Dates;
use App\Support\RenewalRules;
use App\Support\Rules;
use App\Trpc\Context;
use App\Trpc\Registry;
use App\Trpc\TrpcException;
use App\Trpc\Validate;
use Illuminate\Support\Facades\DB;

/**
 * workforce.*, mirroring server/routers/workforce.ts.
 *
 * Staff profiles and the safer-recruitment record behind each one: identity,
 * DBS, right to work, references, induction and the training that has to be
 * kept current.
 */
final class WorkforceRouter
{
    private const EMPLOYMENT_TYPES = ['permanent', 'fixed_term', 'casual', 'agency', 'volunteer'];

    private const CHECK_TYPES = [
        'identity', 'dbs', 'right_to_work', 'reference', 'employment_gap', 'qualification',
        'training', 'induction', 'probation', 'supervision', 'appraisal', 'policy_acknowledgement',
    ];

    private const CHECK_STATUSES = [
        'missing', 'pending', 'valid', 'expiring', 'expired', 'rejected', 'not_applicable',
    ];

    /**
     * Every new profile starts with the safer-recruitment record already laid
     * out and marked missing, so a gap is visible from the first day rather than
     * only when somebody thinks to look for it.
     *
     * @var array<int, array{checkType: string, title: string}>
     */
    private const STARTER_CHECKS = [
        ['checkType' => 'identity', 'title' => 'Identity verified'],
        ['checkType' => 'dbs', 'title' => 'Eligible DBS check'],
        ['checkType' => 'right_to_work', 'title' => 'Right to Work check'],
        ['checkType' => 'reference', 'title' => 'First verified reference'],
        ['checkType' => 'reference', 'title' => 'Second verified reference'],
        ['checkType' => 'induction', 'title' => 'Induction completed'],
    ];

    public static function register(Registry $registry): void
    {
        $registry->query('workforce.list', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'staff.read');

            return DB::table('staffProfiles')->where('entityId', $entityId)->get()
                ->map(static fn ($r) => (array) $r)->all();
        });

        $registry->mutation('workforce.create', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'staff.write');

            $email = ($input['email'] ?? '') === '' ? null : Validate::email($input['email']);
            $employeeNumber = Validate::optionalString($input['employeeNumber'] ?? null, 'employeeNumber', 40);

            // A duplicate profile splits somebody's DBS and training history
            // across two records, and the gap in each looks like a gap in them.
            foreach (DB::table('staffProfiles')->where('entityId', $entityId)
                ->select(['id', 'email', 'employeeNumber'])->get() as $row) {
                $sameEmail = $email !== null && $row->email !== null
                    && strtolower((string) $row->email) === strtolower($email);
                $sameNumber = $employeeNumber !== null && $row->employeeNumber !== null
                    && strtolower((string) $row->employeeNumber) === strtolower($employeeNumber);

                if ($sameEmail || $sameNumber) {
                    throw TrpcException::conflict(
                        "A workforce profile with this email or employee number already exists (#$row->id). Review it instead of adding a duplicate."
                    );
                }
            }

            $profileId = DB::transaction(static function () use ($ctx, $entityId, $email, $employeeNumber, $input): int {
                $id = (int) DB::table('staffProfiles')->insertGetId([
                    'entityId' => $entityId,
                    'fullName' => Validate::string($input['fullName'] ?? null, 'fullName', 2, 180),
                    'email' => $email,
                    'phone' => Validate::optionalString($input['phone'] ?? null, 'phone', 40),
                    'jobTitle' => Validate::string($input['jobTitle'] ?? null, 'jobTitle', 2, 160),
                    'employeeNumber' => $employeeNumber,
                    'employmentType' => Validate::enum($input['employmentType'] ?? null, self::EMPLOYMENT_TYPES, 'employmentType'),
                    'startDate' => isset($input['startDate']) ? Validate::int($input['startDate'], 'startDate') : null,
                    'createdBy' => $ctx->userId(),
                ]);

                $rows = [];
                foreach (self::STARTER_CHECKS as $check) {
                    $rows[] = $check + [
                        'entityId' => $entityId,
                        'staffProfileId' => $id,
                        'status' => 'missing',
                        'createdBy' => $ctx->userId(),
                    ];
                }
                DB::table('workforceChecks')->insert($rows);

                return $id;
            });

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'staff.create',
                'resourceType' => 'staff_profile',
                'resourceId' => $profileId,
                'sensitivity' => 'hr',
                'result' => 'success',
            ]);

            return ['id' => $profileId];
        });

        $registry->query('workforce.checks', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $staffProfileId = Validate::id($input['staffProfileId'] ?? null, 'staffProfileId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'staff.sensitive');

            $rows = DB::table('workforceChecks')->where('staffProfileId', $staffProfileId)->get();

            // Reading somebody's DBS record is itself recorded, because a
            // question about who looked at it should have an answer.
            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'staff_checks.read',
                'resourceType' => 'staff_profile',
                'resourceId' => $staffProfileId,
                'sensitivity' => 'hr',
                'result' => 'allowed',
            ]);

            return $rows->map(static function ($row): array {
                $item = (array) $row;
                // A check that is valid with no expiry counts as complete rather
                // than as having no date.
                $completedAt = $row->status === 'valid' && $row->expiresAt === null ? Dates::nowMillis() : null;
                $item['ragStatus'] = Rules::ragStatus(
                    $row->expiresAt === null ? null : (int) $row->expiresAt,
                    $completedAt,
                    30,
                );

                return $item;
            })->all();
        });

        $registry->mutation('workforce.createCheck', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $staffProfileId = Validate::id($input['staffProfileId'] ?? null, 'staffProfileId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'staff.sensitive');

            $profile = DB::table('staffProfiles')->where('id', $staffProfileId)->where('entityId', $entityId)->first('id');
            if ($profile === null) {
                throw TrpcException::notFound('Staff member is not available in this entity');
            }

            $issuedAt = isset($input['issuedAt']) ? Validate::int($input['issuedAt'], 'issuedAt') : null;
            $expiresAt = isset($input['expiresAt']) ? Validate::int($input['expiresAt'], 'expiresAt') : null;
            self::assertDateOrder($issuedAt, $expiresAt);

            $evidenceDocumentId = Validate::optionalId($input['evidenceDocumentId'] ?? null, 'evidenceDocumentId');
            self::assertHrEvidence($entityId, $evidenceDocumentId);

            $templateId = Validate::optionalId($input['templateId'] ?? null, 'templateId');
            $template = null;
            if ($templateId !== null) {
                $template = DB::table('documentTemplates')->where('id', $templateId)->first();
                if ($template === null || (int) $template->entityId !== $entityId
                    || $template->category !== 'supervision' || $template->status !== 'active') {
                    throw TrpcException::badRequest('Selected supervision template is not available');
                }
            }

            // A check is only valid once approved evidence sits behind it; until
            // then it is pending, however the dates read.
            $status = 'pending';
            if ($evidenceDocumentId !== null) {
                $band = RenewalRules::band($expiresAt)['band'];
                $status = $band === 'overdue' ? 'expired'
                    : (in_array($band, ['one_month', 'two_months', 'three_months'], true) ? 'expiring' : 'valid');
            }

            $checkId = (int) DB::table('workforceChecks')->insertGetId([
                'entityId' => $entityId,
                'staffProfileId' => $staffProfileId,
                'checkType' => Validate::enum($input['checkType'] ?? null, self::CHECK_TYPES, 'checkType'),
                'title' => Validate::string($input['title'] ?? null, 'title', 3, 200),
                'issuedAt' => $issuedAt,
                'expiresAt' => $expiresAt,
                'reference' => Validate::optionalString($input['reference'] ?? null, 'reference', 160),
                'level' => Validate::optionalEnum($input['level'] ?? null, RenewalRules::STAFF_CATEGORIES, 'level'),
                'evidenceDocumentId' => $evidenceDocumentId,
                'notes' => Validate::optionalString($input['notes'] ?? null, 'notes', 8000) ?? ($template->bodyTemplate ?? null),
                'status' => $status,
                'verifiedAt' => $evidenceDocumentId !== null ? Dates::nowMillis() : null,
                'verifiedBy' => $evidenceDocumentId !== null ? $ctx->userId() : null,
                'createdBy' => $ctx->userId(),
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'staff_check.create',
                'resourceType' => 'workforce_check',
                'resourceId' => $checkId,
                'sensitivity' => 'hr',
                'result' => 'success',
                'metadata' => [
                    'checkType' => $input['checkType'],
                    'templateId' => $template->id ?? null,
                    'templateVersion' => $template->version ?? null,
                ],
            ]);

            return ['id' => $checkId];
        });

        $registry->mutation('workforce.updateCheck', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $id = Validate::id($input['id'] ?? null, 'id');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'staff.sensitive');

            $status = Validate::enum($input['status'] ?? null, self::CHECK_STATUSES, 'status');
            $issuedAt = isset($input['issuedAt']) ? Validate::int($input['issuedAt'], 'issuedAt') : null;
            $expiresAt = isset($input['expiresAt']) ? Validate::int($input['expiresAt'], 'expiresAt') : null;
            self::assertDateOrder($issuedAt, $expiresAt);

            $evidenceDocumentId = Validate::optionalId($input['evidenceDocumentId'] ?? null, 'evidenceDocumentId');
            self::assertHrEvidence($entityId, $evidenceDocumentId);

            $verified = in_array($status, ['valid', 'expiring'], true);

            DB::table('workforceChecks')->where('id', $id)->where('entityId', $entityId)->update([
                'status' => $status,
                'reference' => Validate::optionalString($input['reference'] ?? null, 'reference', 160),
                'level' => Validate::optionalEnum($input['level'] ?? null, RenewalRules::STAFF_CATEGORIES, 'level'),
                'issuedAt' => $issuedAt,
                'expiresAt' => $expiresAt,
                'evidenceDocumentId' => $evidenceDocumentId,
                'notes' => Validate::optionalString($input['notes'] ?? null, 'notes', 2000),
                // Marking a check valid records who said so and when.
                'verifiedAt' => $verified ? Dates::nowMillis() : null,
                'verifiedBy' => $verified ? $ctx->userId() : null,
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'staff_check.update',
                'resourceType' => 'workforce_check',
                'resourceId' => $id,
                'sensitivity' => 'hr',
                'result' => 'success',
                'metadata' => ['status' => $status],
            ]);

            return ['success' => true];
        });
    }

    private static function assertDateOrder(?int $issuedAt, ?int $expiresAt): void
    {
        if ($issuedAt !== null && $expiresAt !== null && $expiresAt <= $issuedAt) {
            throw TrpcException::badRequest(
                'Renewal or expiry date must be after the issue or completion date. Correct the date before saving.'
            );
        }
    }

    /**
     * Certificate evidence has to be an approved document classified HR. An
     * unapproved one has been checked by nobody, and one classified otherwise
     * would be readable by people who should not see a DBS certificate.
     */
    private static function assertHrEvidence(int $entityId, ?int $documentId): void
    {
        if ($documentId === null) {
            return;
        }

        $document = DB::table('documents')->where('id', $documentId)->where('entityId', $entityId)
            ->first(['id', 'status', 'classification']);

        if ($document === null) {
            throw TrpcException::badRequest('Selected certificate evidence is not available in this entity');
        }
        if ($document->classification !== 'hr') {
            throw TrpcException::badRequest('Staff certificate evidence must use the HR classification');
        }
        if ($document->status !== 'approved') {
            throw TrpcException::badRequest('Staff certificate evidence must be approved before it can validate this record');
        }
    }
}
