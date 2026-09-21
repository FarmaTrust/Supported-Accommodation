<?php

declare(strict_types=1);

namespace App\Trpc\Routers;

use App\Support\Audit;
use App\Support\Authz;
use App\Support\Automation;
use App\Support\Dates;
use App\Support\EvidenceReminders;
use App\Support\RoleNavigation;
use App\Support\Rules;
use App\Trpc\Context;
use App\Trpc\Registry;
use App\Trpc\TrpcException;
use App\Trpc\Validate;
use Illuminate\Support\Facades\DB;

/**
 * workspace.*, mirroring server/routers/workspace.ts.
 *
 * The shell the app loads around everything else: search, the sidebar, alerts,
 * saved views, recently-viewed records, the data-quality panel and the
 * scheduling of the background checks.
 */
final class WorkspaceRouter
{
    /** What each role may see in search results and shortcuts. */
    private const DOCUMENT_CLASSIFICATIONS = [
        'owner' => ['general', 'hr', 'finance', 'safeguarding', 'bank', 'restricted'],
        'registered_manager' => ['general', 'safeguarding', 'restricted'],
        'hr_compliance' => ['general', 'hr'],
        'finance' => ['general', 'finance'],
    ];

    private const WORKFORCE_ROLES = ['owner', 'registered_manager', 'hr_compliance'];
    private const FINANCE_ROLES = ['owner', 'registered_manager', 'finance'];

    public static function register(Registry $registry): void
    {
        $registry->query('workspace.search', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $query = Validate::string($input['query'] ?? null, 'query', 2, 100);
            $access = Authz::assertEntityCapability($ctx->userId(), $entityId, 'property.read');
            $role = (string) $access['role'];

            // Escaped so a search for "100%" is a search and not a wildcard.
            $like = '%' . addcslashes($query, '%_\\') . '%';
            $results = [];

            foreach (DB::table('properties')->where('entityId', $entityId)
                ->where(fn ($q) => $q->where('name', 'like', $like)
                    ->orWhere('addressLine1', 'like', $like)
                    ->orWhere('postcode', 'like', $like))->get() as $row) {
                $results[] = ['type' => 'Property', 'id' => (int) $row->id, 'title' => $row->name,
                    'subtitle' => "$row->addressLine1, $row->postcode", 'path' => '/properties'];
            }

            foreach (DB::table('workPlanActions')->where('entityId', $entityId)
                ->where('title', 'like', $like)->get() as $row) {
                $results[] = ['type' => 'Work plan', 'id' => (int) $row->id, 'title' => $row->title,
                    'subtitle' => str_replace('_', ' ', (string) $row->status), 'path' => '/work-plans'];
            }

            foreach (DB::table('complianceObligations')->where('entityId', $entityId)
                ->where('title', 'like', $like)->get() as $row) {
                $results[] = ['type' => 'Compliance', 'id' => (int) $row->id, 'title' => $row->title,
                    'subtitle' => $row->ragStatus, 'path' => '/compliance'];
            }

            if (in_array($role, self::WORKFORCE_ROLES, true)) {
                foreach (DB::table('staffProfiles')->where('entityId', $entityId)
                    ->where(fn ($q) => $q->where('fullName', 'like', $like)->orWhere('employeeNumber', 'like', $like))
                    ->get() as $row) {
                    $results[] = ['type' => 'Workforce', 'id' => (int) $row->id, 'title' => $row->fullName,
                        'subtitle' => $row->jobTitle, 'path' => '/workforce'];
                }
            }

            $placements = DB::table('placements as p')
                ->join('youngPeople as y', 'y.id', '=', 'p.youngPersonId')
                ->where('p.entityId', $entityId)
                ->where(fn ($q) => $q->where('y.reference', 'like', $like)->orWhere('y.preferredName', 'like', $like))
                ->select(['p.id', 'y.reference', 'y.preferredName'])
                ->get();

            // A support worker searches only the young people they are assigned
            // to; the search box is not a way around the placement boundary.
            if ($role === 'support_worker') {
                $assigned = DB::table('workerAssignments')->where('userId', $ctx->userId())
                    ->pluck('placementId')->map(static fn ($id) => (int) $id)->all();
                $placements = $placements->filter(static fn ($row) => in_array((int) $row->id, $assigned, true));
            }

            foreach ($placements as $row) {
                $results[] = ['type' => 'Placement', 'id' => (int) $row->id, 'title' => $row->reference,
                    'subtitle' => $row->preferredName ?: 'Young-person record', 'path' => '/placements'];
            }

            if (in_array($role, self::FINANCE_ROLES, true)) {
                foreach (DB::table('invoices')->where('entityId', $entityId)
                    ->where(fn ($q) => $q->where('invoiceNumber', 'like', $like)
                        ->orWhere('customerNameSnapshot', 'like', $like)
                        ->orWhere('youngPersonReferenceSnapshot', 'like', $like))->get() as $row) {
                    $results[] = ['type' => 'Invoice', 'id' => (int) $row->id,
                        'title' => $row->invoiceNumber ?: "Draft #$row->id",
                        'subtitle' => ($row->customerNameSnapshot ?: 'Authority') . ' · £' . $row->total,
                        'path' => '/finance/invoice/' . (int) $row->id];
                }
            }

            // Documents are filtered by classification, so a search never
            // reveals the title of a record the caller could not open.
            $allowed = self::DOCUMENT_CLASSIFICATIONS[$role] ?? ['general'];
            foreach (DB::table('documents')->where('entityId', $entityId)
                ->where('title', 'like', $like)->whereIn('classification', $allowed)->get() as $row) {
                $results[] = ['type' => 'Document', 'id' => (int) $row->id, 'title' => $row->title,
                    'subtitle' => "$row->documentType · $row->status", 'path' => '/documents'];
            }

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'workspace.search',
                'resourceType' => 'search',
                'result' => 'success',
                // The query itself is not recorded: it can name a young person.
                'metadata' => ['resultCount' => count($results)],
            ]);

            return array_slice($results, 0, 50);
        });

        $registry->query('workspace.myNavigation', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $memberships = Authz::userAccess($ctx->userId())['memberships'];

            $membership = null;
            foreach ($memberships as $candidate) {
                if ($candidate['entityId'] === $entityId) {
                    $membership = $candidate;
                    break;
                }
            }

            if ($membership === null) {
                return ['paths' => [], 'roleLabel' => null, 'baseRole' => null];
            }

            $baseRole = (string) $membership['operationalRole'];

            if ($membership['customRoleSlug'] === null) {
                return [
                    'paths' => RoleNavigation::pathsFor($baseRole),
                    'roleLabel' => null,
                    'baseRole' => $baseRole,
                    'capabilities' => [],
                ];
            }

            $role = DB::table('roles')->where('slug', $membership['customRoleSlug'])
                ->where('entityId', $entityId)->first();

            $granted = RoleNavigation::cleanCapabilityList($role->grantedCapabilities ?? null);
            $denied = RoleNavigation::cleanCapabilityList($role->deniedCapabilities ?? null);
            $visiblePaths = RoleNavigation::cleanPathList($role->visiblePaths ?? null);

            return [
                'paths' => RoleNavigation::effectivePaths($baseRole, $visiblePaths),
                'roleLabel' => $role->name ?? null,
                'baseRole' => $baseRole,
                'capabilities' => RoleNavigation::effectiveCapabilities($baseRole, $granted, $denied),
            ];
        });

        $registry->query('workspace.notifications', Registry::USER, static function (Context $ctx): array {
            $now = Dates::nowMillis();

            return DB::table('notifications')
                ->where('userId', $ctx->userId())
                ->whereNull('resolvedAt')
                // A snoozed alert comes back on its own once the snooze expires.
                ->where(fn ($q) => $q->whereNull('snoozedUntil')->orWhere('snoozedUntil', '<=', $now))
                ->orderByDesc('createdAt')
                ->limit(100)
                ->get()->map(static fn ($r) => (array) $r)->all();
        });

        $registry->mutation('workspace.markNotificationRead', Registry::USER, static function (Context $ctx, mixed $input): array {
            $id = Validate::id($input['id'] ?? null, 'id');
            $item = self::ownNotification($ctx, $id);

            DB::table('notifications')->where('id', $item->id)->where('userId', $ctx->userId())->update([
                'readAt' => Dates::nowMillis(),
                'escalationState' => 'acknowledged',
            ]);

            return ['success' => true];
        });

        $registry->mutation('workspace.snoozeNotification', Registry::USER, static function (Context $ctx, mixed $input): array {
            $id = Validate::id($input['id'] ?? null, 'id');
            $days = Validate::int($input['days'] ?? null, 'days', 1, 30);
            $item = self::ownNotification($ctx, $id);

            // How long an alert may be put off is set by the company's own rule,
            // not by whoever is trying to put it off.
            $ruleType = match ($item->type) {
                'plan_review' => 'review',
                'placement_review' => 'placement',
                default => $item->type,
            };

            $allowedDays = 3;
            if ($item->entityId !== null) {
                $rule = DB::table('automationRules')
                    ->where('entityId', $item->entityId)->where('ruleType', $ruleType)->where('enabled', 1)
                    ->first('configuration');

                if ($rule !== null) {
                    $configuration = is_string($rule->configuration) ? json_decode($rule->configuration, true) : $rule->configuration;
                    $allowedDays = (int) ($configuration['snoozeDays'] ?? 3);
                }
            }

            if ($days > $allowedDays) {
                throw TrpcException::badRequest("This reminder can be snoozed for no more than $allowedDays days");
            }

            $snoozedUntil = Dates::nowMillis() + $days * 86400000;

            DB::table('notifications')->where('id', $id)->update([
                'snoozedUntil' => $snoozedUntil,
                'readAt' => Dates::nowMillis(),
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $item->entityId === null ? null : (int) $item->entityId,
                'action' => 'notification.snooze',
                'resourceType' => 'notification',
                'resourceId' => (int) $item->id,
                'result' => 'success',
                'metadata' => ['days' => $days, 'snoozedUntil' => $snoozedUntil],
            ]);

            return ['snoozedUntil' => $snoozedUntil];
        });

        $registry->mutation('workspace.resolveNotification', Registry::USER, static function (Context $ctx, mixed $input): array {
            $id = Validate::id($input['id'] ?? null, 'id');
            $item = self::ownNotification($ctx, $id);
            $now = Dates::nowMillis();

            DB::table('notifications')->where('id', $id)->update([
                'resolvedAt' => $now,
                'readAt' => $now,
                'escalationState' => 'resolved',
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $item->entityId === null ? null : (int) $item->entityId,
                'action' => 'notification.resolve',
                'resourceType' => 'notification',
                'resourceId' => (int) $item->id,
                'result' => 'success',
            ]);

            return ['success' => true];
        });

        $registry->query('workspace.savedViews', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $access = Authz::userAccess($ctx->userId());

            $role = $access['user']['operationalRole'] === 'owner' ? 'owner' : 'read_only';
            foreach ($access['memberships'] as $membership) {
                if ($membership['entityId'] === $entityId) {
                    $role = (string) $membership['operationalRole'];
                    break;
                }
            }

            $rows = DB::table('savedViews')
                ->where('userId', $ctx->userId())->where('entityId', $entityId)->get();

            if ($rows->isNotEmpty()) {
                return $rows->map(static fn ($r) => (array) $r)->all();
            }

            // Somebody opening the workspace for the first time gets a view that
            // suits their job rather than an empty list.
            $defaults = [
                'owner' => ['Owner priorities', 'overdue'],
                'registered_manager' => ['Manager actions', 'review'],
                'support_worker' => ['My assigned records', 'assigned'],
                'hr_compliance' => ['Workforce compliance', 'training'],
                'finance' => ['Finance exceptions', 'overdue'],
                'read_only' => ['Recent evidence', 'evidence'],
            ];
            [$name, $query] = $defaults[$role] ?? $defaults['read_only'];

            return [[
                'id' => 0,
                'userId' => $ctx->userId(),
                'entityId' => $entityId,
                'name' => $name,
                'viewType' => 'search',
                'filters' => ['query' => $query],
                'isDefault' => 1,
                'createdAt' => Dates::fromMillis(0),
                'updatedAt' => Dates::fromMillis(0),
                'source' => 'role_default',
            ]];
        });

        $registry->mutation('workspace.saveView', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'property.read');

            $name = Validate::string($input['name'] ?? null, 'name', 2, 140);
            $viewType = Validate::string($input['viewType'] ?? null, 'viewType', 2, 80);
            $filters = Validate::object($input['filters'] ?? null, 'filters');
            $isDefault = Validate::bool($input['isDefault'] ?? false, 'isDefault');

            $id = DB::transaction(static function () use ($ctx, $entityId, $name, $viewType, $filters, $isDefault): int {
                // Only one default per view type, so the previous one is cleared
                // before the new one is written.
                if ($isDefault) {
                    DB::table('savedViews')
                        ->where('userId', $ctx->userId())->where('entityId', $entityId)->where('viewType', $viewType)
                        ->update(['isDefault' => 0]);
                }

                DB::table('savedViews')->upsert([[
                    'userId' => $ctx->userId(),
                    'entityId' => $entityId,
                    'name' => $name,
                    'viewType' => $viewType,
                    'filters' => json_encode($filters, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                    'isDefault' => $isDefault ? 1 : 0,
                ]], ['userId', 'entityId', 'name'], ['filters', 'isDefault']);

                return (int) DB::table('savedViews')
                    ->where('userId', $ctx->userId())->where('entityId', $entityId)->where('name', $name)
                    ->value('id');
            });

            return ['id' => $id];
        });

        $registry->mutation('workspace.trackRecord', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'property.read');

            $path = Validate::string($input['path'] ?? null, 'path', 1, 500);
            if (!str_starts_with($path, '/')) {
                throw TrpcException::badRequest('Path must start with /.');
            }

            $resourceId = $input['resourceId'] ?? null;
            if (!is_string($resourceId) && !is_int($resourceId)) {
                throw TrpcException::badRequest('Resource id is required.');
            }

            DB::table('recordShortcuts')->upsert([[
                'userId' => $ctx->userId(),
                'entityId' => $entityId,
                'resourceType' => Validate::string($input['resourceType'] ?? null, 'resourceType', 2, 80),
                'resourceId' => (string) $resourceId,
                'title' => Validate::string($input['title'] ?? null, 'title', 1, 220),
                'path' => $path,
                'lastViewedAt' => Dates::nowMillis(),
            ]], ['userId', 'entityId', 'resourceType', 'resourceId'], ['title', 'path', 'lastViewedAt']);

            return ['success' => true];
        });

        $registry->query('workspace.shortcuts', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $access = Authz::assertEntityCapability($ctx->userId(), $entityId, 'property.read');
            $role = (string) $access['role'];

            $rows = DB::table('recordShortcuts')
                ->where('userId', $ctx->userId())->where('entityId', $entityId)
                ->orderByDesc('lastViewedAt')->limit(30)->get();

            // A shortcut was saved when the caller could still open the record.
            // Their role may have narrowed since, so the list is filtered again
            // on the way out rather than trusted.
            if (!in_array($role, self::WORKFORCE_ROLES, true)) {
                $rows = $rows->filter(static fn ($r) => $r->resourceType !== 'Workforce');
            }
            if (!in_array($role, self::FINANCE_ROLES, true)) {
                $rows = $rows->filter(static fn ($r) => $r->resourceType !== 'Invoice');
            }
            if ($role === 'support_worker') {
                $assigned = DB::table('workerAssignments')->where('userId', $ctx->userId())
                    ->pluck('placementId')->map(static fn ($id) => (string) $id)->all();
                $rows = $rows->filter(static fn ($r) => $r->resourceType !== 'Placement'
                    || in_array((string) $r->resourceId, $assigned, true));
            }

            return [
                'favorites' => $rows->filter(static fn ($r) => (int) $r->isFavorite === 1)
                    ->map(static fn ($r) => (array) $r)->values()->all(),
                'recent' => $rows->take(10)->map(static fn ($r) => (array) $r)->values()->all(),
            ];
        });

        $registry->mutation('workspace.toggleFavorite', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'property.read');

            DB::table('recordShortcuts')
                ->where('id', Validate::id($input['id'] ?? null, 'id'))
                ->where('userId', $ctx->userId())
                ->where('entityId', $entityId)
                ->update(['isFavorite' => Validate::bool($input['favorite'] ?? null, 'favorite') ? 1 : 0]);

            return ['success' => true];
        });

        $registry->query('workspace.dataQuality', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $access = Authz::assertEntityCapability($ctx->userId(), $entityId, 'property.read');
            $role = (string) $access['role'];
            $propertyIds = Authz::accessiblePropertyIds($ctx->userId(), $entityId, 'property.read');

            $now = Dates::nowMillis();
            $staleAt = $now - 180 * 86400000;
            $issues = [];

            $properties = $propertyIds === []
                ? collect()
                : DB::table('properties')->whereIn('id', $propertyIds)->get();

            $seen = [];
            foreach ($properties as $property) {
                $identity = Rules::normaliseForComparison($property->addressLine1 . '|' . $property->postcode);

                if (isset($seen[$identity])) {
                    $issues[] = ['key' => 'duplicate-property-' . $property->id, 'severity' => 'urgent',
                        'title' => 'Possible duplicate property',
                        'message' => "$property->name matches another accessible address. Compare before adding records.",
                        'path' => '/properties'];
                } else {
                    $seen[$identity] = (int) $property->id;
                }

                $updatedAt = Dates::fromDatabase($property->updatedAt);
                if ($updatedAt !== null && $updatedAt->getTimestamp() * 1000 < $staleAt) {
                    $issues[] = ['key' => 'stale-property-' . $property->id, 'severity' => 'warning',
                        'title' => 'Property facts need review',
                        'message' => "$property->name has not been reviewed for more than 180 days.",
                        'path' => '/properties'];
                }
            }

            $validEvidence = $propertyIds === [] ? [] : DB::table('propertyEvidence')
                ->whereIn('propertyId', $propertyIds)->where('status', 'valid')
                ->pluck('propertyId')->map(static fn ($id) => (int) $id)->all();

            foreach ($properties as $property) {
                if ($property->status === 'active' && !in_array((int) $property->id, $validEvidence, true)) {
                    $issues[] = ['key' => 'evidence-' . $property->id, 'severity' => 'urgent',
                        'title' => 'Active property lacks valid evidence',
                        'message' => "$property->name has no valid property-evidence record linked.",
                        'path' => '/properties'];
                }
            }

            // Each section is gated by the capability it reports on, so the panel
            // never tells someone about records they cannot open.
            if (Authz::roleHasCapability($role, 'staff.sensitive')) {
                $checks = DB::table('workforceChecks')->where('entityId', $entityId)->get();
                foreach (DB::table('staffProfiles')->where('entityId', $entityId)->where('status', 'active')->get() as $person) {
                    $theirs = $checks->filter(static fn ($c) => (int) $c->staffProfileId === (int) $person->id);
                    $hasDbs = $theirs->contains(static fn ($c) => $c->checkType === 'dbs' && $c->status === 'valid');
                    $hasRtw = $theirs->contains(static fn ($c) => $c->checkType === 'right_to_work' && $c->status === 'valid');

                    if (!$hasDbs || !$hasRtw) {
                        $issues[] = ['key' => 'workforce-' . $person->id, 'severity' => 'urgent',
                            'title' => 'Safer-recruitment evidence incomplete',
                            'message' => "$person->fullName is active without both valid DBS and Right to Work states.",
                            'path' => '/workforce'];
                    }
                }
            }

            if (Authz::roleHasCapability($role, 'young_person.read')) {
                $approvedPlans = DB::table('carePlans')->where('entityId', $entityId)->where('status', 'approved')
                    ->pluck('placementId')->map(static fn ($id) => (int) $id)->all();

                foreach (DB::table('placements')->where('entityId', $entityId)->where('status', 'active')->get() as $placement) {
                    if (!in_array((int) $placement->id, $approvedPlans, true)) {
                        $issues[] = ['key' => 'plan-' . $placement->id, 'severity' => 'urgent',
                            'title' => 'Active placement lacks an approved plan',
                            'message' => "Placement #$placement->id needs an approved support, pathway, risk or placement plan.",
                            'path' => '/placements'];
                    }
                }
            }

            if (Authz::roleHasCapability($role, 'finance.read')) {
                $invoiceSeen = [];
                foreach (DB::table('invoices')->where('entityId', $entityId)->where('status', '!=', 'void')->get() as $invoice) {
                    $key = $invoice->placementId . '|' . $invoice->periodStart . '|' . $invoice->periodEnd;
                    if (isset($invoiceSeen[$key])) {
                        $issues[] = ['key' => 'duplicate-invoice-' . $invoice->id, 'severity' => 'urgent',
                            'title' => 'Possible duplicate invoice period',
                            'message' => ($invoice->invoiceNumber ?? "Draft #$invoice->id") . ' overlaps an existing placement and fee period.',
                            'path' => '/finance/invoice/' . (int) $invoice->id];
                    }
                    $invoiceSeen[$key] = true;
                }
            }

            if (Authz::roleHasCapability($role, 'compliance.write')) {
                $rules = DB::table('automationRules')->where('entityId', $entityId)->where('enabled', 1)->get();

                if ($rules->isEmpty()) {
                    $issues[] = ['key' => 'automation-missing', 'severity' => 'warning',
                        'title' => 'Daily checks are not enabled',
                        'message' => 'Enable managed automation after publishing, or run the evaluator manually.',
                        'path' => '/search'];
                } elseif ($rules->every(static fn ($r) => $r->lastRunAt === null || (int) $r->lastRunAt < $now - 2 * 86400000)) {
                    // Automation that stopped running is worse than none, because
                    // the absence of alerts reads as everything being fine.
                    $issues[] = ['key' => 'automation-stale', 'severity' => 'urgent',
                        'title' => 'Background checks appear stale',
                        'message' => 'No enabled automation rule has completed in the last 48 hours.',
                        'path' => '/search'];
                }
            }

            $count = static fn (string $severity) => count(array_filter($issues, static fn ($i) => $i['severity'] === $severity));

            return [
                'checkedAt' => $now,
                'staleAfterDays' => 180,
                'issues' => array_slice($issues, 0, 50),
                'counts' => ['urgent' => $count('urgent'), 'warning' => $count('warning'), 'info' => $count('info')],
            ];
        });

        $registry->query('workspace.automationRules', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'compliance.write');

            return DB::table('automationRules')->where('entityId', $entityId)->get()
                ->map(static fn ($r) => (array) $r)->all();
        });

        $registry->mutation('workspace.createDailyAutomation', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'compliance.write');

            $cron = Validate::optionalString($input['cron'] ?? null, 'cron', 60) ?? '0 7 * * *';
            EvidenceReminders::assertCron($cron);

            $ruleId = (int) DB::table('automationRules')->insertGetId([
                'entityId' => $entityId,
                'name' => 'Daily operations and renewal checks',
                'ruleType' => 'compliance',
                'configuration' => json_encode([
                    'includes' => [
                        'compliance', 'property_certificates', 'staff_checks', 'staff_training', 'reviews',
                        'work_plans', 'policies', 'placements', 'invoices', 'rota_coverage',
                    ],
                    // The Node server registered this with the Manus heartbeat
                    // service, which this deployment cannot reach. The schedule
                    // is stored here instead and read by the scheduled command,
                    // so the cron entry on the host drives every company's rules
                    // rather than each one holding a remote job id.
                    'cron' => $cron,
                ], JSON_UNESCAPED_SLASHES),
                'createdBy' => $ctx->userId(),
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'automation.daily_checks.configure',
                'resourceType' => 'automation_rule',
                'resourceId' => $ruleId,
                'result' => 'success',
                'metadata' => ['cron' => $cron],
            ]);

            return ['id' => $ruleId, 'nextExecutionAt' => null];
        });

        $registry->query('workspace.evidenceReminderSettings', Registry::USER, static function (Context $ctx, mixed $input): ?array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            self::assertReminderManager($ctx, $entityId, 'view');

            $rule = DB::table('automationRules')
                ->where('entityId', $entityId)->where('ruleType', 'evidence')->first();

            if ($rule === null) {
                return null;
            }

            $configuration = is_string($rule->configuration) ? json_decode($rule->configuration, true) : $rule->configuration;

            return [
                'id' => (int) $rule->id,
                'enabled' => (int) $rule->enabled === 1,
                'configuration' => EvidenceReminders::normalise(is_array($configuration) ? $configuration : []),
                'scheduleCronTaskUid' => $rule->scheduleCronTaskUid,
                'lastRunAt' => $rule->lastRunAt,
            ];
        });

        $registry->mutation('workspace.saveEvidenceReminderSettings', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            self::assertReminderManager($ctx, $entityId, 'configure');

            $enabled = Validate::bool($input['enabled'] ?? null, 'enabled');
            $configuration = EvidenceReminders::normalise([
                'enabled' => $enabled,
                'staffEvidenceReviewHours' => Validate::int($input['staffEvidenceReviewHours'] ?? null, 'staffEvidenceReviewHours', 1, 720),
                'documentReviewLeadDays' => Validate::int($input['documentReviewLeadDays'] ?? null, 'documentReviewLeadDays', 1, 365),
                'retentionReviewLeadDays' => Validate::int($input['retentionReviewLeadDays'] ?? null, 'retentionReviewLeadDays', 1, 365),
                'runAtHourUtc' => Validate::int($input['runAtHourUtc'] ?? 7, 'runAtHourUtc', 0, 23),
            ]);

            $ruleId = DB::transaction(static function () use ($ctx, $entityId, $configuration, $enabled): int {
                $existing = DB::table('automationRules')
                    ->where('entityId', $entityId)->where('ruleType', 'evidence')->first('id');

                $payload = [
                    'configuration' => json_encode($configuration, JSON_UNESCAPED_SLASHES),
                    'enabled' => $enabled ? 1 : 0,
                ];

                if ($existing !== null) {
                    DB::table('automationRules')->where('id', $existing->id)->update($payload);

                    return (int) $existing->id;
                }

                return (int) DB::table('automationRules')->insertGetId($payload + [
                    'entityId' => $entityId,
                    'name' => 'Evidence review and retention reminders',
                    'ruleType' => 'evidence',
                    'createdBy' => $ctx->userId(),
                ]);
            });

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'automation.evidence_reminders.configure',
                'resourceType' => 'automation_rule',
                'resourceId' => $ruleId,
                'result' => 'success',
                'metadata' => $configuration + ['enabled' => $enabled],
            ]);

            return ['id' => $ruleId, 'nextExecutionAt' => null];
        });

        $registry->mutation('workspace.runAutomationNow', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'compliance.write');

            // Run in the request rather than queued. There is no worker on this
            // deployment, and a button that silently queued work nobody would
            // run would be worse than one that takes a moment.
            $result = Automation::run($entityId);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'automation.manual_run',
                'resourceType' => 'automation',
                'result' => 'success',
                'metadata' => $result,
            ]);

            return $result;
        });
    }

    /** @return object */
    private static function ownNotification(Context $ctx, int $id): object
    {
        $item = DB::table('notifications')->where('id', $id)->where('userId', $ctx->userId())->first();
        if ($item === null) {
            throw TrpcException::notFound('Notification not found');
        }

        return $item;
    }

    /**
     * Reminder settings decide when everyone else is chased, so they are an
     * Owner or Registered Manager decision rather than anyone holding
     * compliance.write.
     */
    private static function assertReminderManager(Context $ctx, int $entityId, string $verb): void
    {
        $access = Authz::assertEntityCapability($ctx->userId(), $entityId, 'compliance.write');

        if (!in_array($access['role'], ['owner', 'registered_manager'], true)) {
            throw TrpcException::forbidden(
                "Only an Owner or Registered Manager can $verb evidence reminders"
            );
        }
    }
}
