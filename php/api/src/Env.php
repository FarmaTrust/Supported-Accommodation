<?php
declare(strict_types=1);

namespace Hub;

/**
 * Reads the same .env file the Node server uses, so a single file configures
 * both runtimes during the migration. Real environment variables win, which is
 * what lets the host set secrets without a file on disk.
 */
final class Env
{
    private static bool $loaded = false;

    public static function load(string $path): void
    {
        if (self::$loaded || !is_file($path)) {
            self::$loaded = true;
            return;
        }
        self::$loaded = true;

        foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
            $line = trim($line);
            if ($line === '' || str_starts_with($line, '#')) {
                continue;
            }
            $split = strpos($line, '=');
            if ($split === false) {
                continue;
            }

            $key = trim(substr($line, 0, $split));
            $value = trim(substr($line, $split + 1));
            if (strlen($value) >= 2 && ($value[0] === '"' || $value[0] === "'") && $value[-1] === $value[0]) {
                $value = substr($value, 1, -1);
            }

            if (getenv($key) === false) {
                putenv("$key=$value");
                $_ENV[$key] = $value;
            }
        }
    }

    public static function get(string $key, ?string $default = null): ?string
    {
        $value = getenv($key);
        if ($value === false || $value === '') {
            return $_ENV[$key] ?? $default;
        }

        return $value;
    }

    public static function require(string $key): string
    {
        $value = self::get($key);
        if ($value === null || $value === '') {
            throw new \RuntimeException("$key is required but not set");
        }

        return $value;
    }
}
