<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

$app = Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // The API is called by a React SPA over tRPC, not by forms, and it
        // authenticates with a signed cookie rather than a Laravel session, so
        // none of the stateful web middleware applies.
        $middleware->api(prepend: []);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();

// One environment file configures every runtime in this repository: the Node
// server, the plain-PHP API and Laravel all read the .env beside the client, so
// a secret is never rotated in one place and missed in another. On the server
// that file sits above the document root.
$app->useEnvironmentPath(dirname(__DIR__, 2));

return $app;
