<?php

declare(strict_types=1);

namespace App\Trpc\Routers;

use App\Support\Audit;
use App\Support\Authz;
use App\Support\ComplianceRenewals;
use App\Support\RenewalRules;
use App\Support\Rules;
use App\Trpc\Context;
use App\Trpc\Registry;
use App\Trpc\Validate;
use Illuminate\Support\Facades\DB;

/**
 * complianceHub.*, mirroring server/routers/complianceHub.ts.
 *
 * One board for everything that expires: property certificates, staff checks,
 * the certificate library they are filed in, and the outbox of renewal chases.
 *
 * Staff compliance is behind staff.sensitive rather than compliance.read. A DBS
 * result and a right-to-work check say things about a person that a property
 * certificate does not, so a reader without that capability sees the property
 * side and is told plainly that the staff side is withheld.
 */
final class ComplianceHubRouter
{
    public static function register(Registry $registry): void
    {
        $registry->query('complianceHub.workspace', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $access = Authz::assertEntityCapability($ctx->userId(), $entityId, 'compliance.read');
            $propertyIds = Authz::accessiblePropertyIds($ctx->userId(), $entityId, 'compliance.read');

            $canReadStaff = Authz::roleHasCapability($access['role'], 'staff.sensitive');
            $unrestricted = $access['role'] === 'owner' || $access['allProperties'];

            $properties = $propertyIds === [] ? [] : DB::table('properties')
                ->where('entityId', $entityId)->whereIn('id', $propertyIds)
                ->get(['id', 'name', 'addressLine1'])->map(static fn ($r) => (array) $r)->all();

            $propertyNames = [];
            foreach ($properties as $property) {
                $propertyNames[(int) $property['id']] = $property['name'];
            }

            $propertyItems = [];
            if ($propertyIds !== []) {
                foreach (DB::table('propertyEvidence')
                    ->where('entityId', $entityId)->whereIn('propertyId', $propertyIds)->get() as $row) {
                    $category = RenewalRules::propertyCategory((string) $row->recordType, (string) $row->title, $row->details);
                    if ($category === null) {
                        continue;
                    }

                    $renewal = RenewalRules::band($row->dueAt === null ? null : (int) $row->dueAt);
                    // A certificate with no approved evidence behind it is red
                    // whatever its date says: the date is a claim until the
                    // document is there.
                    $evidenceReady = $row->documentId !== null
                        && !in_array($row->status, ['draft', 'action_required'], true);

                    $propertyItems[] = $renewal + [
                        'id' => (int) $row->id,
                        'propertyId' => (int) $row->propertyId,
                        'propertyName' => $propertyNames[(int) $row->propertyId] ?? 'Property',
                        'category' => $category,
                        'categoryLabel' => Rules::PROPERTY_COMPLIANCE_LABELS[$category],
                        'title' => $row->title,
                        'reference' => $row->reference,
                        'dueAt' => $row->dueAt === null ? null : (int) $row->dueAt,
                        'documentId' => $row->documentId === null ? null : (int) $row->documentId,
                        'hasEvidence' => $evidenceReady,
                        'ragStatus' => $evidenceReady ? $renewal['ragStatus'] : 'red',
                        'label' => $evidenceReady ? $renewal['label'] : 'Approved evidence required',
                    ];
                }
            }

            $staffItems = [];
            $staffOptions = [];
            if ($canReadStaff) {
                $profiles = DB::table('staffProfiles')->where('entityId', $entityId)->get();

                if (!$unrestricted) {
                    $assignedUserIds = $propertyIds === [] ? [] : DB::table('propertyAssignments')
                        ->where('entityId', $entityId)->whereIn('propertyId', $propertyIds)
                        ->pluck('userId')->map(static fn ($id) => (int) $id)->all();

                    $profiles = $profiles->filter(static fn ($profile) => $profile->userId !== null
                        && in_array((int) $profile->userId, $assignedUserIds, true));
                }

                $profileNames = [];
                $profileIds = [];
                foreach ($profiles as $profile) {
                    $profileIds[] = (int) $profile->id;
                    $profileNames[(int) $profile->id] = $profile->fullName;
                    $staffOptions[] = ['id' => (int) $profile->id, 'fullName' => $profile->fullName];
                }

                if ($profileIds !== []) {
                    foreach (DB::table('workforceChecks')
                        ->where('entityId', $entityId)->whereIn('staffProfileId', $profileIds)->get() as $row) {
                        $category = RenewalRules::staffCategory((string) $row->checkType, $row->level);
                        if ($category === null) {
                            continue;
                        }

                        $renewal = RenewalRules::band($row->expiresAt === null ? null : (int) $row->expiresAt);
                        $evidenceReady = $row->evidenceDocumentId !== null
                            && in_array($row->status, ['valid', 'expiring', 'expired'], true);

                        $staffItems[] = $renewal + [
                            'id' => (int) $row->id,
                            'staffProfileId' => (int) $row->staffProfileId,
                            'staffName' => $profileNames[(int) $row->staffProfileId] ?? 'Staff member',
                            'category' => $category,
                            'categoryLabel' => RenewalRules::STAFF_LABELS[$category],
                            'title' => $row->title,
                            'reference' => $row->reference,
                            'dueAt' => $row->expiresAt === null ? null : (int) $row->expiresAt,
                            'documentId' => $row->evidenceDocumentId === null ? null : (int) $row->evidenceDocumentId,
                            'hasEvidence' => $evidenceReady,
                            'ragStatus' => $evidenceReady ? $renewal['ragStatus'] : 'red',
                            'label' => $evidenceReady ? $renewal['label'] : 'Approved evidence required',
                        ];
                    }
                }
            }

            $connection = DB::table('integrationConnections')
                ->where('entityId', $entityId)->where('integrationType', 'email')->first();

            $deliveries = $connection === null ? [] : DB::table('integrationDeliveries')
                ->where('entityId', $entityId)
                ->where('connectionId', $connection->id)
                ->where('deliveryType', 'email')
                ->orderByDesc('createdAt')->limit(50)
                ->get()->map(static fn ($r) => (array) $r)->all();

            $latestAttempt = [];
            $deliveryIds = array_map(static fn (array $row) => (int) $row['id'], $deliveries);
            if ($deliveryIds !== []) {
                foreach (DB::table('integrationAttempts')
                    ->whereIn('deliveryId', $deliveryIds)->orderByDesc('startedAt')->get() as $attempt) {
                    $latestAttempt[(int) $attempt->deliveryId] ??= (array) $attempt;
                }
            }

            $documentColumns = ['id', 'title', 'propertyId', 'folderId', 'classification', 'status', 'documentType', 'currentVersion'];
            $documentQuery = DB::table('documents')
                ->where('entityId', $entityId)->where('documentType', 'certificate');

            if (!$unrestricted) {
                if ($propertyIds === []) {
                    $documentQuery = null;
                } else {
                    $documentQuery->whereIn('propertyId', $propertyIds);
                }
            }

            $documentRows = $documentQuery === null
                ? []
                : $documentQuery->get($documentColumns)->map(static fn ($r) => (array) $r)->all();

            // An HR-classified certificate is a staff record filed as a
            // document; the staff gate follows it there.
            if (!$canReadStaff) {
                $documentRows = array_values(array_filter(
                    $documentRows,
                    static fn (array $row) => $row['classification'] !== 'hr',
                ));
            }

            $latestVersion = [];
            $documentIds = array_map(static fn (array $row) => (int) $row['id'], $documentRows);
            if ($documentIds !== []) {
                foreach (DB::table('documentVersions')
                    ->whereIn('documentId', $documentIds)->orderByDesc('createdAt')
                    ->get(['documentId', 'scanStatus', 'fileName', 'createdAt']) as $version) {
                    $latestVersion[(int) $version->documentId] ??= $version;
                }
            }

            $folders = DB::table('documentFolders')->where('entityId', $entityId)
                ->get()->map(static fn ($r) => (array) $r)->all();

            $folderNames = [];
            foreach ($folders as $folder) {
                $folderNames[(int) $folder['id']] = $folder['name'];
            }

            $certificateLibrary = [];
            foreach ($documentRows as $row) {
                $version = $latestVersion[(int) $row['id']] ?? null;
                $certificateLibrary[] = $row + [
                    'folderName' => $row['folderId'] === null
                        ? 'Uncategorised'
                        : ($folderNames[(int) $row['folderId']] ?? 'Uncategorised'),
                    'scanStatus' => $version->scanStatus ?? 'pending',
                    'fileName' => $version->fileName ?? null,
                ];
            }

            return [
                'summary' => [
                    'all' => self::counts(array_merge($propertyItems, $staffItems)),
                    'property' => self::counts($propertyItems),
                    'staff' => self::counts($staffItems),
                ],
                'propertyCategories' => array_map(
                    static fn (string $value) => ['value' => $value, 'label' => Rules::PROPERTY_COMPLIANCE_LABELS[$value]],
                    Rules::PROPERTY_COMPLIANCE_KINDS,
                ),
                'staffCategories' => array_map(
                    static fn (string $value) => ['value' => $value, 'label' => RenewalRules::STAFF_LABELS[$value]],
                    RenewalRules::STAFF_CATEGORIES,
                ),
                'properties' => $properties,
                'propertyItems' => $propertyItems,
                'staffItems' => $staffItems,
                'staffOptions' => $staffOptions,
                // Said out loud rather than shown as an empty list, so a reader
                // does not conclude there is nothing outstanding.
                'staffRestricted' => !$canReadStaff,
                'staffEvidenceDocuments' => !$canReadStaff ? [] : array_values(array_map(
                    static fn (array $item) => [
                        'id' => (int) $item['id'], 'title' => $item['title'], 'folderName' => $item['folderName'],
                    ],
                    array_filter($certificateLibrary, static fn (array $item) => $item['classification'] === 'hr'
                        && $item['status'] === 'approved'
                        && $item['scanStatus'] === 'clean'),
                )),
                'email' => [
                    'providerStatus' => $connection->status ?? 'not_connected',
                    'connectionName' => $connection->name ?? null,
                    'outboxCount' => count($deliveries),
                    'deliveries' => array_map(
                        static fn (array $row) => $row + ['latestAttempt' => $latestAttempt[(int) $row['id']] ?? null],
                        $deliveries,
                    ),
                ],
                'certificateLibrary' => $certificateLibrary,
                'folders' => $folders,
            ];
        });

        $registry->mutation('complianceHub.runRenewalCheck', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'compliance.write');

            $result = ComplianceRenewals::run($entityId);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'compliance_renewal.manual_run',
                'resourceType' => 'entity',
                'resourceId' => $entityId,
                'result' => 'success',
                'metadata' => $result,
            ]);

            return $result;
        });

        $registry->mutation('complianceHub.ensureCertificateLibrary', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'document.write');

            $existing = DB::table('documentFolders')->where('entityId', $entityId)->get();

            $root = $existing->first(static fn ($folder) => $folder->parentFolderId === null && $folder->name === 'Certificates');
            $rootId = $root === null
                ? (int) DB::table('documentFolders')->insertGetId([
                    'entityId' => $entityId,
                    'name' => 'Certificates',
                    'classification' => 'restricted',
                    'createdBy' => $ctx->userId(),
                ])
                : (int) $root->id;

            $created = 0;
            foreach (RenewalRules::CERTIFICATE_LIBRARY_FOLDERS as $name) {
                $alreadyThere = $existing->contains(
                    static fn ($folder) => $folder->parentFolderId !== null
                        && (int) $folder->parentFolderId === $rootId
                        && $folder->name === $name,
                );
                if ($alreadyThere) {
                    continue;
                }

                DB::table('documentFolders')->insert([
                    'entityId' => $entityId,
                    'parentFolderId' => $rootId,
                    'name' => $name,
                    // A staff folder inherits the HR classification, so what is
                    // filed in it is behind the staff gate by default.
                    'classification' => str_starts_with($name, 'Staff') ? 'hr' : 'restricted',
                    'createdBy' => $ctx->userId(),
                ]);
                $created++;
            }

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'certificate_library.ensure',
                'resourceType' => 'document_folder',
                'resourceId' => $rootId,
                'result' => 'success',
                'metadata' => ['created' => $created],
            ]);

            return [
                'rootFolderId' => $rootId,
                'created' => $created,
                'total' => count(RenewalRules::CERTIFICATE_LIBRARY_FOLDERS),
            ];
        });
    }

    /**
     * @param array<int, array<string, mixed>> $items
     * @return array<string, int>
     */
    private static function counts(array $items): array
    {
        $counts = ['green' => 0, 'amber' => 0, 'red' => 0, 'grey' => 0];

        foreach ($items as $item) {
            $status = (string) $item['ragStatus'];
            $counts[$status] = ($counts[$status] ?? 0) + 1;
        }

        return $counts;
    }
}
