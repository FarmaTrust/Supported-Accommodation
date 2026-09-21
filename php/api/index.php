<?php
declare(strict_types=1);

/**
 * Front controller for the PHP API.
 *
 * Everything under /api/trpc/ is dispatched here; anything else is the built
 * SPA, which the web server serves directly (see .htaccess). Errors are logged
 * in full and answered with a generic message, because this endpoint is public.
 */

require __DIR__ . '/src/Env.php';
require __DIR__ . '/src/Jwt.php';
require __DIR__ . '/src/Superjson.php';
require __DIR__ . '/src/TrpcError.php';
require __DIR__ . '/src/Db.php';
require __DIR__ . '/src/Users.php';
require __DIR__ . '/src/LocalAuth.php';
require __DIR__ . '/src/Audit.php';
require __DIR__ . '/src/Context.php';
require __DIR__ . '/src/Trpc.php';
require __DIR__ . '/src/Routers/AuthRouter.php';

use Hub\Context;
use Hub\Env;
use Hub\Routers\AuthRouter;
use Hub\Superjson;
use Hub\Trpc;

Env::load(getenv('HUB_ENV_FILE') ?: dirname(__DIR__, 2) . '/.env');

// Errors go to the log, never to the response: a PHP notice printed before the
// JSON body would make every tRPC reply unparseable, and a stack trace would
// leak record contents to the browser.
ini_set('display_errors', '0');
error_reporting(E_ALL);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

$requestPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$prefix = '/api/trpc/';

if (!str_starts_with($requestPath, $prefix)) {
    http_response_code(404);
    echo json_encode(['error' => ['message' => 'Not found']]);
    exit;
}

$trpc = new Trpc();
AuthRouter::register($trpc);

try {
    $ctx = Context::fromRequest();
    $response = $trpc->handle(
        $ctx,
        $_SERVER['REQUEST_METHOD'] ?? 'GET',
        substr($requestPath, strlen($prefix)),
        $_GET,
        (string) file_get_contents('php://input')
    );

    http_response_code($response['status']);
    echo json_encode($response['body'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
} catch (Throwable $error) {
    error_log('[api] ' . $error::class . ': ' . $error->getMessage() . ' @ ' . $error->getFile() . ':' . $error->getLine());
    http_response_code(500);
    echo json_encode(['error' => Superjson::encode([
        'message' => 'Something went wrong on the server.',
        'code' => -32603,
        'data' => ['code' => 'INTERNAL_SERVER_ERROR', 'httpStatus' => 500, 'path' => ''],
    ])], JSON_UNESCAPED_SLASHES);
}
