<?php

declare(strict_types=1);

namespace App\Trpc\Routers;

use App\Support\Audit;
use App\Support\Authz;
use App\Support\Crypto;
use App\Support\Dates;
use App\Support\SecureLinks;
use App\Trpc\Context;
use App\Trpc\Registry;
use App\Trpc\TrpcException;
use App\Trpc\Validate;
use Illuminate\Support\Facades\DB;

/**
 * documents.*, mirroring server/routers/documents.ts.
 *
 * The document library, the provider packs built from it, and the share links
 * that let a placing authority read a pack without an account.
 */
final class DocumentsRouter
{
    private const DOCUMENT_TYPES = [
        'policy', 'template', 'certificate', 'contract', 'plan', 'evidence', 'generated', 'other',
    ];

    private const CLASSIFICATIONS = ['general', 'hr', 'finance', 'safeguarding', 'bank', 'restricted'];

    public static function register(Registry $registry): void
    {
        // Public on purpose: the recipient has no account, and the link is the
        // credential. Every limit on it is enforced below.
        $registry->query('documents.resolveSecureLink', Registry::PUBLIC, static function (Context $ctx, mixed $input): array {
            $token = Validate::token(
                $input['token'] ?? null,
                'This secure link is invalid, expired, revoked or has reached its view limit',
                32,
                200,
            );

            $unavailable = static fn (): TrpcException => TrpcException::notFound(
                'This secure link is invalid, expired, revoked or has reached its view limit'
            );

            $result = DB::transaction(static function () use ($token, $unavailable): array {
                // Looked up by hash, so the stored row never contains the link.
                $link = DB::table('secureLinks')
                    ->where('tokenHash', SecureLinks::hashToken($token))
                    ->lockForUpdate()->first();

                if ($link === null || !SecureLinks::isUsable($link) || $link->providerPackId === null) {
                    throw $unavailable();
                }

                $pack = DB::table('providerPacks')->where('id', $link->providerPackId)->first();
                if ($pack === null || !in_array($pack->status, ['ready', 'shared'], true)) {
                    throw TrpcException::notFound('Shared pack is unavailable');
                }

                // Counted inside the transaction with the row locked, so a link
                // capped at ten views cannot be opened eleven times at once.
                DB::table('secureLinks')->where('id', $link->id)->update([
                    'viewCount' => (int) $link->viewCount + 1,
                    'lastViewedAt' => Dates::nowMillis(),
                ]);

                DB::table('providerPacks')->where('id', $pack->id)->update(['status' => 'shared']);

                return ['link' => $link, 'pack' => $pack];
            });

            $pack = $result['pack'];
            $link = $result['link'];

            Audit::write([
                'actorType' => 'secure_link',
                'entityId' => (int) $pack->entityId,
                'propertyId' => $pack->propertyId === null ? null : (int) $pack->propertyId,
                'action' => 'provider_pack.external_view',
                'resourceType' => 'provider_pack',
                'resourceId' => (int) $pack->id,
                'sensitivity' => (int) $pack->includeBankDetails === 1 ? 'bank' : 'general',
                'result' => 'allowed',
                'metadata' => ['secureLinkId' => (int) $link->id, 'viewNumber' => (int) $link->viewCount + 1],
            ]);

            return [
                'title' => $pack->title,
                'snapshot' => self::decodeJson($pack->snapshot),
                'expiresAt' => (int) $link->expiresAt,
            ];
        });

        $registry->query('documents.list', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'document.read');

            // Documents that belong to a controlled output — a printable export,
            // a quality report or its evidence, an inspection pack — are reached
            // through that record, where their own rules apply. Listing them here
            // as ordinary files would route around those rules.
            $controlled = collect()
                ->merge(DB::table('printableRecordExports')->where('entityId', $entityId)->pluck('documentId'))
                ->merge(DB::table('qualityReviews')->where('entityId', $entityId)->pluck('reportDocumentId'))
                ->merge(DB::table('qualityReviewEvidence')->where('entityId', $entityId)->pluck('documentId'))
                ->merge(DB::table('exportJobs')->where('entityId', $entityId)->where('exportType', 'inspection')->pluck('documentId'))
                ->filter()
                ->map(static fn ($id) => (int) $id)
                ->all();

            return DB::table('documents')->where('entityId', $entityId)
                ->orderByDesc('updatedAt')->get()
                ->reject(static fn ($row) => in_array((int) $row->id, $controlled, true))
                ->map(static fn ($r) => (array) $r)->values()->all();
        });

        $registry->mutation('documents.createMetadata', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'document.write');

            $propertyId = Validate::optionalId($input['propertyId'] ?? null, 'propertyId');
            $classification = Validate::enum($input['classification'] ?? null, self::CLASSIFICATIONS, 'classification');

            $documentId = (int) DB::table('documents')->insertGetId([
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'folderId' => Validate::optionalId($input['folderId'] ?? null, 'folderId'),
                'title' => Validate::string($input['title'] ?? null, 'title', 3, 240),
                'documentType' => Validate::enum($input['documentType'] ?? null, self::DOCUMENT_TYPES, 'documentType'),
                'classification' => $classification,
                'reviewDueAt' => isset($input['reviewDueAt']) ? Validate::int($input['reviewDueAt'], 'reviewDueAt') : null,
                'retentionUntil' => isset($input['retentionUntil']) ? Validate::int($input['retentionUntil'], 'retentionUntil') : null,
                'retentionBasis' => Validate::optionalString($input['retentionBasis'] ?? null, 'retentionBasis', 220),
                // A legal hold keeps a record past its retention date, which is
                // why it is set here rather than derived.
                'legalHold' => Validate::bool($input['legalHold'] ?? false, 'legalHold') ? 1 : 0,
                'createdBy' => $ctx->userId(),
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'action' => 'document.create',
                'resourceType' => 'document',
                'resourceId' => $documentId,
                'sensitivity' => $classification,
                'result' => 'success',
            ]);

            return ['id' => $documentId];
        });

        $registry->query('documents.packs', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'pack.read');

            return DB::table('providerPacks')->where('entityId', $entityId)
                ->orderByDesc('updatedAt')->get()->map(static fn ($r) => (array) $r)->all();
        });

        $registry->mutation('documents.createPack', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'pack.write');

            $includeBankDetails = Validate::bool($input['includeBankDetails'] ?? false, 'includeBankDetails');

            // Putting bank details into a pack is a finance disclosure, so it
            // needs the finance capability on top of the pack one.
            if ($includeBankDetails) {
                Authz::assertEntityCapability($ctx->userId(), $entityId, 'finance.read');
            }

            $propertyId = Validate::optionalId($input['propertyId'] ?? null, 'propertyId');
            $localAuthorityId = Validate::optionalId($input['localAuthorityId'] ?? null, 'localAuthorityId');
            $templateId = Validate::optionalId($input['templateId'] ?? null, 'templateId');

            $entity = DB::table('entities')->where('id', $entityId)->first();
            if ($entity === null) {
                throw TrpcException::notFound('Entity not found');
            }

            $property = $propertyId === null ? null
                : DB::table('properties')->where('id', $propertyId)->where('entityId', $entityId)->first();
            $authority = $localAuthorityId === null ? null
                : DB::table('localAuthorities')->where('id', $localAuthorityId)->where('entityId', $entityId)->first();
            $template = $templateId === null ? null
                : DB::table('documentTemplates')->where('id', $templateId)->where('entityId', $entityId)
                    ->where('category', 'provider_pack')->where('status', 'active')->first();

            // The most specific active fee wins: one tied to both this property
            // and this authority beats one tied to neither.
            $fee = DB::table('feeSchedules')->where('entityId', $entityId)->where('status', 'active')->get()
                ->filter(static fn ($f) => ($f->propertyId === null || (int) $f->propertyId === $propertyId)
                    && ($f->localAuthorityId === null || (int) $f->localAuthorityId === $localAuthorityId))
                ->sortByDesc(static fn ($f) => (int) ($f->propertyId !== null) + (int) ($f->localAuthorityId !== null))
                ->first();

            $sortCode = $includeBankDetails ? Crypto::decrypt($entity->bankSortCodeCiphertext) : null;
            $accountNumber = $includeBankDetails ? Crypto::decrypt($entity->bankAccountNumberCiphertext) : null;

            $address = static fn (?object $row) => $row === null ? '' : implode(', ', array_filter([
                $row->addressLine1 ?? null, $row->addressLine2 ?? null, $row->city ?? null, $row->postcode ?? null,
            ]));

            $vacancy = $property === null ? null : max(0, (int) $property->capacity - (int) $property->occupiedBeds);

            $renderedTemplate = null;
            if ($template !== null) {
                $values = [
                    'entity.name' => $entity->name,
                    'entity.legalName' => $entity->legalName,
                    'entity.ofstedUrn' => $entity->ofstedUrn ?? '',
                    'entity.companyNumber' => $entity->companyNumber ?? '',
                    'property.name' => $property->name ?? '',
                    'property.address' => $address($property),
                    'property.vacancy' => $vacancy === null ? '' : (string) $vacancy,
                    'authority.name' => $authority->name ?? '',
                    'fee.rate' => $fee->rate ?? '',
                    'fee.billingUnit' => $fee->billingUnit ?? '',
                ];

                // An unknown placeholder is left visible rather than replaced
                // with an empty string, so a template gap is noticed.
                $renderedTemplate = preg_replace_callback(
                    '/\{\{\s*([^}]+?)\s*\}\}/',
                    static fn (array $m) => $values[$m[1]] ?? '{{' . $m[1] . '}}',
                    (string) $template->bodyTemplate,
                );
            }

            $snapshot = [
                // A pack is a snapshot on purpose: what was sent stays what was
                // sent, even after the underlying records move on.
                'generatedAt' => Dates::nowMillis(),
                'entity' => [
                    'name' => $entity->name, 'legalName' => $entity->legalName,
                    'companyNumber' => $entity->companyNumber, 'ofstedUrn' => $entity->ofstedUrn,
                    'email' => $entity->email, 'phone' => $entity->phone, 'address' => $address($entity),
                ],
                'property' => $property === null ? null : [
                    'name' => $property->name, 'address' => $address($property),
                    'accommodationType' => $property->accommodationType, 'capacity' => (int) $property->capacity,
                    'ofstedSettingReference' => $property->ofstedSettingReference, 'vacancy' => $vacancy,
                ],
                'authority' => $authority === null ? null
                    : ['name' => $authority->name, 'placementEmail' => $authority->placementEmail],
                'fee' => $fee === null ? null : [
                    'name' => $fee->name, 'billingUnit' => $fee->billingUnit, 'rate' => $fee->rate,
                    'vatRate' => $fee->vatRate, 'vatTreatment' => $fee->vatTreatment,
                    'placementType' => $fee->placementType, 'contractReference' => $fee->contractReference,
                    'effectiveFrom' => $fee->effectiveFrom, 'effectiveTo' => $fee->effectiveTo,
                ],
                'bankDetailsIncluded' => $includeBankDetails && $entity->bankAccountName && $accountNumber,
                'bankDetails' => $includeBankDetails && $entity->bankAccountName && $sortCode && $accountNumber ? [
                    'accountName' => $entity->bankAccountName,
                    'sortCode' => preg_replace('/(\d{2})(\d{2})(\d{2})/', '$1-$2-$3', $sortCode),
                    'accountNumber' => $accountNumber,
                ] : null,
                'template' => $template === null ? null : [
                    'id' => (int) $template->id, 'title' => $template->title,
                    'version' => $template->version, 'renderedBody' => $renderedTemplate,
                ],
            ];

            $packId = (int) DB::table('providerPacks')->insertGetId([
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'localAuthorityId' => $localAuthorityId,
                'templateId' => $templateId,
                'title' => Validate::string($input['title'] ?? null, 'title', 3, 240),
                'includeBankDetails' => $includeBankDetails ? 1 : 0,
                'snapshot' => json_encode($snapshot, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                'status' => 'ready',
                'createdBy' => $ctx->userId(),
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'action' => 'provider_pack.create',
                'resourceType' => 'provider_pack',
                'resourceId' => $packId,
                'sensitivity' => $includeBankDetails ? 'bank' : 'general',
                'result' => 'success',
                'metadata' => ['templateId' => $template->id ?? null, 'templateVersion' => $template->version ?? null],
            ]);

            return ['id' => $packId, 'snapshot' => $snapshot];
        });

        $registry->mutation('documents.createSecureLink', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'pack.write');

            $providerPackId = Validate::id($input['providerPackId'] ?? null, 'providerPackId');
            $expiresInHours = Validate::int($input['expiresInHours'] ?? 72, 'expiresInHours', 1, 720);
            $maxViews = Validate::int($input['maxViews'] ?? 10, 'maxViews', 1, 100);

            $token = SecureLinks::createToken();

            $linkId = (int) DB::table('secureLinks')->insertGetId([
                'entityId' => $entityId,
                'providerPackId' => $providerPackId,
                // Only the hash is kept. The link is returned once, here, and
                // cannot be recovered from the database afterwards.
                'tokenHash' => SecureLinks::hashToken($token),
                'recipientEmail' => ($input['recipientEmail'] ?? '') === '' ? null : Validate::email($input['recipientEmail']),
                'expiresAt' => Dates::nowMillis() + $expiresInHours * 3600000,
                'maxViews' => $maxViews,
                'createdBy' => $ctx->userId(),
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'secure_link.create',
                'resourceType' => 'secure_link',
                'resourceId' => $linkId,
                'sensitivity' => 'restricted',
                'result' => 'success',
                // The token is never written to the audit trail.
                'metadata' => ['expiresInHours' => $expiresInHours, 'maxViews' => $maxViews],
            ]);

            return ['id' => $linkId, 'path' => "/share/$token"];
        });

        $registry->mutation('documents.revokeSecureLink', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $id = Validate::id($input['id'] ?? null, 'id');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'pack.write');

            DB::table('secureLinks')->where('id', $id)->where('entityId', $entityId)
                ->update(['revokedAt' => Dates::nowMillis()]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'secure_link.revoke',
                'resourceType' => 'secure_link',
                'resourceId' => $id,
                'sensitivity' => 'restricted',
                'result' => 'success',
            ]);

            return ['success' => true];
        });
    }

    private static function decodeJson(mixed $value): mixed
    {
        return is_string($value) ? json_decode($value, true) : $value;
    }
}
