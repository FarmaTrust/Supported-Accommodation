<?php

declare(strict_types=1);

namespace App\Support;

/**
 * A factual roll-up of keywork report states, mirroring
 * server/services/reportCompletion.ts.
 *
 * "logged" means a report that has been submitted, reviewed, approved or
 * locked. It deliberately does not infer an expected schedule or a completion
 * percentage: the system does not know how many reports a worker was supposed
 * to write, and a made-up denominator on a manager's screen is how a worker
 * ends up answering for a number nobody defined.
 */
final class ReportCompletion
{
    private const STATUSES = ['draft', 'submitted', 'reviewed', 'returned', 'approved', 'locked'];

    private const LOGGED = ['submitted', 'reviewed', 'approved', 'locked'];

    private const NEEDS_COMPLETION = ['draft', 'returned'];

    private const AWAITING_REVIEW = ['submitted', 'reviewed'];

    private const APPROVED_OR_LOCKED = ['approved', 'locked'];

    /**
     * @param array<int, array{id: int, propertyId: int, propertyName: string, authorUserId: int, authorName: ?string, status: string, reportDate: int}> $rows
     * @return array<int, array<string, mixed>>
     */
    public static function summarise(array $rows): array
    {
        $properties = [];

        foreach ($rows as $row) {
            $propertyId = $row['propertyId'];
            $authorId = $row['authorUserId'];

            if (!isset($properties[$propertyId])) {
                $properties[$propertyId] = [
                    'propertyId' => $propertyId,
                    'propertyName' => $row['propertyName'],
                    'counts' => self::emptyCounts(),
                    'latestReportAt' => null,
                    'workers' => [],
                ];
            }

            if (!isset($properties[$propertyId]['workers'][$authorId])) {
                $name = trim((string) ($row['authorName'] ?? ''));
                $properties[$propertyId]['workers'][$authorId] = [
                    'userId' => $authorId,
                    // A worker whose account has no name still has to be
                    // nameable on the manager's screen.
                    'name' => $name === '' ? "Key Worker $authorId" : $name,
                    'counts' => self::emptyCounts(),
                    'latestReportAt' => null,
                ];
            }

            self::addCount($properties[$propertyId]['counts'], $row['status']);
            self::addCount($properties[$propertyId]['workers'][$authorId]['counts'], $row['status']);

            $properties[$propertyId]['latestReportAt'] = max(
                $properties[$propertyId]['latestReportAt'] ?? 0,
                $row['reportDate'],
            ) ?: null;
            $properties[$propertyId]['workers'][$authorId]['latestReportAt'] = max(
                $properties[$propertyId]['workers'][$authorId]['latestReportAt'] ?? 0,
                $row['reportDate'],
            ) ?: null;
        }

        $out = [];
        foreach ($properties as $property) {
            $workers = array_values($property['workers']);
            usort($workers, static fn (array $left, array $right) => strcmp($left['name'], $right['name']));

            $out[] = [
                'propertyId' => $property['propertyId'],
                'propertyName' => $property['propertyName'],
                'counts' => $property['counts'],
                'latestReportAt' => $property['latestReportAt'],
                'keyWorkers' => $workers,
            ];
        }

        usort($out, static fn (array $left, array $right) => strcmp($left['propertyName'], $right['propertyName']));

        return $out;
    }

    /** @return array<string, int> */
    private static function emptyCounts(): array
    {
        $counts = [];
        foreach (self::STATUSES as $status) {
            $counts[$status] = 0;
        }

        return $counts + ['logged' => 0, 'needsCompletion' => 0, 'awaitingReview' => 0, 'approvedOrLocked' => 0];
    }

    /** @param array<string, int> $counts */
    private static function addCount(array &$counts, string $status): void
    {
        if (!array_key_exists($status, $counts)) {
            return;
        }

        $counts[$status]++;

        foreach ([
            'logged' => self::LOGGED,
            'needsCompletion' => self::NEEDS_COMPLETION,
            'awaitingReview' => self::AWAITING_REVIEW,
            'approvedOrLocked' => self::APPROVED_OR_LOCKED,
        ] as $rollUp => $members) {
            if (in_array($status, $members, true)) {
                $counts[$rollUp]++;
            }
        }
    }
}
