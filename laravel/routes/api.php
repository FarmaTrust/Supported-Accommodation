<?php

declare(strict_types=1);

use App\Http\Controllers\EvidenceController;
use App\Http\Controllers\TrpcController;
use Illuminate\Support\Facades\Route;

/*
 * The client batches procedures into one request, so a single catch-all route
 * takes the whole path ("auth.me,auth.status") and the registry splits it.
 * Laravel prefixes this group with /api, which is why the pattern is trpc/…
 */
Route::match(['get', 'post'], 'trpc/{path}', TrpcController::class)
    ->where('path', '.*');

/*
 * Uploaded evidence. Files are held outside the document root, so this route is
 * the only way to them, and it re-checks permission on every request rather
 * than handing out a link that works on its own.
 */
Route::get('evidence/{key}', EvidenceController::class)
    ->where('key', '.*');
