<?php
declare(strict_types=1);

namespace Hub;

use PDO;

/**
 * One lazily-opened PDO handle per request, built from the same
 * TIDB_DATABASE_URL the Node server reads so both runtimes are configured
 * identically.
 */
final class Db
{
    private static ?PDO $pdo = null;

    public static function conn(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }

        $url = Env::require('TIDB_DATABASE_URL');
        $parts = parse_url($url);
        if ($parts === false || !isset($parts['host'], $parts['path'])) {
            throw new \RuntimeException('TIDB_DATABASE_URL is not a valid mysql:// URL');
        }

        $dsn = sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
            $parts['host'],
            $parts['port'] ?? 3306,
            ltrim($parts['path'], '/')
        );

        self::$pdo = new PDO($dsn, rawurldecode($parts['user'] ?? ''), rawurldecode($parts['pass'] ?? ''), [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            // Real prepared statements, so user input is never interpolated
            // into SQL even if a driver-side emulation bug exists.
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);

        return self::$pdo;
    }

    /**
     * @param array<int|string, mixed> $params
     * @return array<int, array<string, mixed>>
     */
    public static function all(string $sql, array $params = []): array
    {
        $statement = self::conn()->prepare($sql);
        $statement->execute($params);

        return $statement->fetchAll();
    }

    /**
     * @param array<int|string, mixed> $params
     * @return array<string, mixed>|null
     */
    public static function first(string $sql, array $params = []): ?array
    {
        $rows = self::all($sql, $params);

        return $rows[0] ?? null;
    }

    /** @param array<int|string, mixed> $params */
    public static function run(string $sql, array $params = []): int
    {
        $statement = self::conn()->prepare($sql);
        $statement->execute($params);

        return $statement->rowCount();
    }

    /** MySQL DATETIME/TIMESTAMP text to the DateTimeImmutable superjson will tag as a Date. */
    public static function toDate(?string $value): ?\DateTimeImmutable
    {
        if ($value === null || $value === '' || str_starts_with($value, '0000-00-00')) {
            return null;
        }

        return new \DateTimeImmutable($value, new \DateTimeZone('UTC'));
    }
}
