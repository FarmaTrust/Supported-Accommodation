<?php

declare(strict_types=1);

use App\Http\Controllers\TrpcController;
use Illuminate\Support\Facades\Route;

/*
 * The client batches procedures into one request, so a single catch-all route
 * takes the whole path ("auth.me,auth.status") and the registry splits it.
 * Laravel prefixes this group with /api, which is why the pattern is trpc/…
 */
Route::match(['get', 'post'], 'trpc/{path}', TrpcController::class)
    ->where('path', '.*');
