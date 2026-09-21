<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Support\Audit;
use App\Support\Automation;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Runs the automation sweep for every company that has enabled it.
 *
 * This replaces the Node deployment's cron endpoint, which the Manus heartbeat
 * service called once per automation rule with that rule's task id. There is no
 * such service here, so one host cron entry runs this command and it works out
 * which companies are due itself.
 *
 * One company failing does not stop the rest. A sweep that fell over on the
 * first company would silently stop chasing every other company's overdue
 * safeguarding reviews, which is a worse failure than a logged error.
 */
final class RunAutomation extends Command
{
    protected $signature = 'automation:run {--entity= : Sweep one company rather than every enabled one}';

    protected $description = 'Raise notifications for anything overdue or coming due';

    public function handle(): int
    {
        $entityIds = $this->option('entity') !== null
            ? [(int) $this->option('entity')]
            : DB::table('automationRules')
                ->whereNotNull('entityId')->where('enabled', 1)
                ->distinct()->pluck('entityId')->map(static fn ($id) => (int) $id)->all();

        if ($entityIds === []) {
            $this->info('No company has automation enabled.');

            return self::SUCCESS;
        }

        $failed = 0;

        foreach ($entityIds as $entityId) {
            try {
                $result = Automation::run($entityId);

                DB::table('automationRules')
                    ->where('entityId', $entityId)->where('enabled', 1)
                    ->update(['lastRunAt' => now()->getTimestampMs()]);

                $this->info(sprintf(
                    'entity %d: evaluated %d, raised %d',
                    $entityId, $result['evaluated'], $result['notificationsUpserted'],
                ));
            } catch (Throwable $error) {
                $failed++;
                report($error);
                $this->error("entity $entityId: " . $error->getMessage());

                // Recorded rather than only logged: a company whose sweep keeps
                // failing is not being chased about anything, and that has to be
                // visible in the trail rather than only in a log file nobody
                // reads.
                Audit::write([
                    'actorType' => 'scheduled_job',
                    'entityId' => $entityId,
                    'action' => 'automation.scheduled_run',
                    'resourceType' => 'automation',
                    'resourceId' => $entityId,
                    'result' => 'failure',
                    'reasonCode' => 'sweep_failed',
                ]);
            }
        }

        return $failed > 0 ? self::FAILURE : self::SUCCESS;
    }
}
