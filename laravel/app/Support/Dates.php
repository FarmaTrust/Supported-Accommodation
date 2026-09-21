<?php

declare(strict_types=1);

namespace App\Support;

use DateTimeImmutable;
use DateTimeZone;

/**
 * Conversions between what MySQL hands back and what superjson has to send.
 *
 * Two shapes reach us. Columns declared `timestamp` come back as a datetime
 * string, and the many `bigint` millisecond columns come back as a number.
 * Both must leave as DateTimeImmutable so superjson tags them as Dates and the
 * client receives a Date rather than a string.
 */
final class Dates
{
    /** A `timestamp` column: "2026-09-21 10:30:57", always read as UTC. */
    public static function fromDatabase(mixed $value): ?DateTimeImmutable
    {
        if ($value instanceof DateTimeImmutable) {
            return $value;
        }
        if (!is_string($value) || $value === '' || str_starts_with($value, '0000-00-00')) {
            return null;
        }

        return new DateTimeImmutable($value, new DateTimeZone('UTC'));
    }

    /** A `bigint` column holding milliseconds since the epoch. */
    public static function fromMillis(mixed $value): ?DateTimeImmutable
    {
        if ($value === null || $value === '') {
            return null;
        }

        $millis = (int) $value;
        $seconds = intdiv($millis, 1000);
        $remainder = $millis - ($seconds * 1000);

        return (new DateTimeImmutable('@' . $seconds))
            ->setTimezone(new DateTimeZone('UTC'))
            ->modify("+$remainder milliseconds") ?: null;
    }

    public static function nowMillis(): int
    {
        return (int) round(microtime(true) * 1000);
    }
}
