<?php
declare(strict_types=1);

namespace Hub;

/**
 * Password credentials and lockout, mirroring server/services/localAuth.ts.
 *
 * The Node server stores scrypt digests as "scrypt$N$r$p$salt$key" with a
 * 16-byte salt. PHP cannot reproduce those: its only scrypt binding,
 * sodium_crypto_pwhash_scryptsalsa208sha256, requires a 32-byte salt and
 * exposes opslimit/memlimit rather than N/r/p, so a hash written by Node can be
 * read here but never verified. New credentials are therefore written with
 * password_hash()'s argon2id, which PHP verifies natively.
 *
 * A leftover scrypt digest is recognised and refused rather than misread, so a
 * user carried over from the Node database is told to reset their password
 * instead of being let in or failing for no stated reason.
 */
final class LocalAuth
{
    private const MAX_FAILED_ATTEMPTS = 5;
    private const LOCKOUT_MS = 900000;
    private const RESET_TTL_MS = 3600000;

    public static function isLegacyScryptHash(string $hash): bool
    {
        return str_starts_with($hash, 'scrypt$');
    }

    public static function normaliseEmail(string $email): string
    {
        return strtolower(trim($email));
    }

    /** Returns the reason the password is unacceptable, or null when it is fine. */
    public static function validatePassword(string $password): ?string
    {
        $length = strlen($password);
        if ($length < 6) {
            return 'Use at least 6 characters.';
        }
        if ($length > 256) {
            return 'Use no more than 256 characters.';
        }
        if (preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $password) === 1) {
            return 'Remove control characters from the password.';
        }

        $classes = (int) (preg_match('/[a-z]/', $password) === 1)
            + (int) (preg_match('/[A-Z]/', $password) === 1)
            + (int) (preg_match('/\d/', $password) === 1)
            + (int) (preg_match('/[^A-Za-z0-9]/', $password) === 1);
        if ($classes < 3) {
            return 'Use at least three of: lowercase, uppercase, number and symbol.';
        }

        return null;
    }

    public static function hashPassword(string $password): string
    {
        $issue = self::validatePassword($password);
        if ($issue !== null) {
            throw TrpcError::badRequest($issue);
        }

        return password_hash($password, PASSWORD_ARGON2ID);
    }

    public static function verifyPassword(string $password, string $storedHash): bool
    {
        if (self::isLegacyScryptHash($storedHash)) {
            return false;
        }

        return password_verify($password, $storedHash);
    }

    public static function sessionIsCurrent(int $userId, ?int $passwordVersion): bool
    {
        if ($passwordVersion === null || $passwordVersion === 0) {
            return false;
        }

        $row = Db::first('SELECT passwordVersion FROM localAuthCredentials WHERE userId = ? LIMIT 1', [$userId]);

        return $row !== null && (int) $row['passwordVersion'] === $passwordVersion;
    }

    public static function requiresPasswordChange(int $userId): bool
    {
        $row = Db::first('SELECT mustChangePassword FROM localAuthCredentials WHERE userId = ? LIMIT 1', [$userId]);

        return $row !== null && (int) $row['mustChangePassword'] === 1;
    }

    /** @return array{failedAttempts: int, lockedUntil: int|null} */
    public static function nextFailedLoginState(int $currentFailedAttempts, int $nowMs): array
    {
        $failedAttempts = $currentFailedAttempts + 1;
        $lockedUntil = $failedAttempts >= self::MAX_FAILED_ATTEMPTS ? $nowMs + self::LOCKOUT_MS : null;

        return ['failedAttempts' => $lockedUntil !== null ? 0 : $failedAttempts, 'lockedUntil' => $lockedUntil];
    }

    public static function nowMs(): int
    {
        return (int) round(microtime(true) * 1000);
    }

    /**
     * Statuses match server/services/localAuth.ts, with reset_required added for
     * a credential that still holds a Node-era scrypt digest.
     *
     * @return array<string, mixed>
     */
    public static function attemptLogin(string $email, string $password, ?int $nowMs = null): array
    {
        $now = $nowMs ?? self::nowMs();
        $emailNormalized = self::normaliseEmail($email);

        $record = Db::first(
            'SELECT c.id AS credentialId, c.passwordHash, c.passwordVersion, c.mustChangePassword,
                    c.failedAttempts, c.lockedUntil, u.*
               FROM localAuthCredentials c
               JOIN users u ON u.id = c.userId
              WHERE c.emailNormalized = ?
              LIMIT 1',
            [$emailNormalized]
        );

        // An unknown address and a suspended account answer identically, so the
        // response cannot be used to work out who holds an account.
        if ($record === null || $record['accountStatus'] !== 'active') {
            return ['status' => 'invalid'];
        }

        if ($record['lockedUntil'] !== null && (int) $record['lockedUntil'] > $now) {
            return ['status' => 'locked'];
        }

        if (self::isLegacyScryptHash((string) $record['passwordHash'])) {
            return ['status' => 'reset_required'];
        }

        if (!self::verifyPassword($password, (string) $record['passwordHash'])) {
            $next = self::nextFailedLoginState((int) $record['failedAttempts'], $now);
            Db::run(
                'UPDATE localAuthCredentials SET failedAttempts = ?, lockedUntil = ?, lastFailedAt = ? WHERE id = ?',
                [$next['failedAttempts'], $next['lockedUntil'], $now, $record['credentialId']]
            );

            return $next['lockedUntil'] !== null ? ['status' => 'locked'] : ['status' => 'invalid'];
        }

        Db::run(
            'UPDATE localAuthCredentials SET failedAttempts = 0, lockedUntil = NULL WHERE id = ?',
            [$record['credentialId']]
        );

        $user = $record;
        foreach (['credentialId', 'passwordHash', 'passwordVersion', 'mustChangePassword', 'failedAttempts', 'lockedUntil'] as $key) {
            unset($user[$key]);
        }

        return [
            'status' => 'success',
            'user' => $user,
            'passwordVersion' => (int) $record['passwordVersion'],
            'mustChangePassword' => (int) $record['mustChangePassword'] === 1,
        ];
    }

    /** @return array{passwordVersion: int, created: bool} */
    public static function createOrReplaceCredential(int $userId, string $email, string $password, bool $requireChangeOnNextLogin = false): array
    {
        $emailNormalized = self::normaliseEmail($email);
        $passwordHash = self::hashPassword($password);
        $now = self::nowMs();

        $existing = Db::first('SELECT id, passwordVersion FROM localAuthCredentials WHERE userId = ? LIMIT 1', [$userId]);

        if ($existing !== null) {
            $version = (int) $existing['passwordVersion'] + 1;
            Db::run(
                'UPDATE localAuthCredentials
                    SET emailNormalized = ?, passwordHash = ?, passwordVersion = ?, mustChangePassword = ?,
                        failedAttempts = 0, lockedUntil = NULL, lastPasswordChangedAt = ?,
                        resetTokenHash = NULL, resetExpiresAt = NULL, resetUsedAt = ?
                  WHERE id = ?',
                [$emailNormalized, $passwordHash, $version, $requireChangeOnNextLogin ? 1 : 0, $now, $now, $existing['id']]
            );

            return ['passwordVersion' => $version, 'created' => false];
        }

        Db::run(
            'INSERT INTO localAuthCredentials (userId, emailNormalized, passwordHash, mustChangePassword, lastPasswordChangedAt)
             VALUES (?, ?, ?, ?, ?)',
            [$userId, $emailNormalized, $passwordHash, $requireChangeOnNextLogin ? 1 : 0, $now]
        );

        return ['passwordVersion' => 1, 'created' => true];
    }

    public static function hashResetToken(string $token): string
    {
        return hash('sha256', $token);
    }

    public static function createResetToken(): string
    {
        return Jwt::base64UrlEncode(random_bytes(32));
    }

    /** @return array{token: string, expiresAt: int} */
    public static function issuePasswordReset(int $userId): array
    {
        $credential = Db::first('SELECT id FROM localAuthCredentials WHERE userId = ? LIMIT 1', [$userId]);
        if ($credential === null) {
            throw TrpcError::badRequest('Local credential is not configured');
        }

        $token = self::createResetToken();
        $now = self::nowMs();
        $expiresAt = $now + self::RESET_TTL_MS;

        Db::run(
            'UPDATE localAuthCredentials SET resetTokenHash = ?, resetExpiresAt = ?, resetUsedAt = NULL WHERE id = ?',
            [self::hashResetToken($token), $expiresAt, $credential['id']]
        );

        return ['token' => $token, 'expiresAt' => $expiresAt];
    }

    /** @return array{userId: int}|null */
    public static function resetPassword(string $token, string $password): ?array
    {
        $passwordHash = self::hashPassword($password);
        $now = self::nowMs();
        $tokenHash = self::hashResetToken($token);

        $credential = Db::first(
            'SELECT id, userId, passwordVersion FROM localAuthCredentials
              WHERE resetTokenHash = ? AND resetExpiresAt > ? AND resetUsedAt IS NULL LIMIT 1',
            [$tokenHash, $now]
        );
        if ($credential === null) {
            return null;
        }

        // The WHERE clause repeats the token conditions so two simultaneous
        // redemptions of the same link cannot both succeed.
        $affected = Db::run(
            'UPDATE localAuthCredentials
                SET passwordHash = ?, passwordVersion = ?, mustChangePassword = 0, failedAttempts = 0,
                    lockedUntil = NULL, lastPasswordChangedAt = ?, resetUsedAt = ?,
                    resetTokenHash = NULL, resetExpiresAt = NULL
              WHERE id = ? AND resetUsedAt IS NULL AND resetTokenHash = ?',
            [$passwordHash, (int) $credential['passwordVersion'] + 1, $now, $now, $credential['id'], $tokenHash]
        );

        return $affected > 0 ? ['userId' => (int) $credential['userId']] : null;
    }

    /**
     * Signs the version-bound session token. Both runtimes accept it, because
     * the claims and the HS256 secret are the ones sdk.createLocalSessionToken
     * uses.
     *
     * @param array<string, mixed> $user
     */
    public static function issueSession(array $user, int $passwordVersion): string
    {
        $oneYearSeconds = 365 * 24 * 60 * 60;

        return Jwt::sign([
            'openId' => $user['openId'],
            'appId' => Env::get('VITE_APP_ID') ?: 'local',
            'name' => $user['name'] ?: ($user['email'] ?: 'Hub user'),
            'authType' => 'local',
            'passwordVersion' => $passwordVersion,
        ], Env::require('JWT_SECRET'), time() + $oneYearSeconds);
    }
}
