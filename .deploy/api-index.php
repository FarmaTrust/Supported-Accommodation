<?php

/**
 * Laravel's front controller, for the Hostinger layout.
 *
 * This is the only PHP file inside the document root. The application itself
 * sits beside public_html rather than below it:
 *
 *   ~/domains/micare.online/
 *   ├── .env
 *   ├── laravel/        app bootstrap config routes storage vendor
 *   └── public_html/    the built SPA, .htaccess, and this file
 *
 * laravel/public/index.php cannot be used unchanged: its paths are relative to
 * itself and would resolve to ~/domains/micare.online/vendor, which does not
 * exist. It stays as it is so `php artisan serve` and `php -S -t laravel/public`
 * still work locally; this is its deployed counterpart.
 */

use Illuminate\Foundation\Application;
use Illuminate\Http\Request;

define('LARAVEL_START', microtime(true));

$laravel = __DIR__ . '/../laravel';

// A missing application directory is the one failure worth naming. Without
// this the page is a bare 500 from a require() of a path nobody can see, and
// the cause — an upload that did not finish, or a composer install that was
// never run — is invisible from the browser.
if (!is_file($laravel . '/vendor/autoload.php')) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'The application is not installed. Check that laravel/vendor exists beside public_html.']);
    exit;
}

if (file_exists($maintenance = $laravel . '/storage/framework/maintenance.php')) {
    require $maintenance;
}

require $laravel . '/vendor/autoload.php';

/** @var Application $app */
$app = require_once $laravel . '/bootstrap/app.php';

$app->handleRequest(Request::capture());
