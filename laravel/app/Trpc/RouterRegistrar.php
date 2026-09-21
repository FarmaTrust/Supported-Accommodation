<?php

declare(strict_types=1);

namespace App\Trpc;

/**
 * Collects every router's procedures into one Registry.
 *
 * Each router class mirrors one file under server/routers/. Adding a ported
 * router means adding its class here and nothing else, which keeps the porting
 * work mechanical rather than each router inventing its own wiring.
 */
final class RouterRegistrar
{
    /** @var array<int, class-string> */
    private const ROUTERS = [
        Routers\AuthRouter::class,
        Routers\ComplianceRouter::class,
        Routers\DocumentsRouter::class,
        Routers\EntitiesRouter::class,
        Routers\PlacementsRouter::class,
        Routers\StaffWorkspaceRouter::class,
        Routers\WorkforceRouter::class,
        Routers\WorkspaceRouter::class,
    ];

    public static function build(): Registry
    {
        $registry = new Registry();

        foreach (self::ROUTERS as $router) {
            $router::register($registry);
        }

        return $registry;
    }
}
