<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

/**
 * The one scheduled job this deployment has.
 *
 * Hourly rather than by the minute: everything it raises is measured in days,
 * and the sweep reads most of the company's tables each time. The host cron
 * entry that drives it is in docs/DEPLOY-HOSTINGER.md.
 *
 * withoutOverlapping, because a sweep that runs long on a large company must
 * not have a second copy start beside it and write the same notifications.
 */
Schedule::command('automation:run')->hourly()->withoutOverlapping();
