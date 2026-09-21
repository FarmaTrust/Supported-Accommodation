<?php

declare(strict_types=1);

namespace App\Support;

use App\Trpc\TrpcException;
use Illuminate\Support\Facades\DB;

/**
 * Password credentials and lockout, mirroring server/services/localAuth.ts.
 *
 * The Node server stores scrypt digests as "scrypt$N$r$p$salt$key" with a
 * 16-byte salt. PHP cannot reproduce those: its only scrypt binding,
 * sodium_crypto_pwhash_scryptsalsa208sha256, requires a 32-byte salt and
 * exposes opslimit/memlimit rather than N/r/p, so a hash written by Node can be
 * read here but never verified.
 *
 * New credentials are written with argon2id. A leftover scrypt digest is
 * recognised and refused with a reset requirement rather than being misread as
 * a wrong password.
 */
final class LocalAuth
{
    private const MAX_FAILED_ATTEMPTS = 5;
    private const LOCKOUT_MS = 900000;
    private const RESET_TTL_MS = 3600000;
    public const SESSION_TTL_SECONDS = 31536000;

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
            throw TrpcException::badRequest($issue);
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

        $row = DB::table('localAuthCredentials')->where('userId', $userId)->first('passwordVersion');

        return $row !== null && (int) $row->passwordVersion === $passwordVersion;
    }

    public static function requiresPasswordChange(int $userId): bool
    {
        $row = DB::table('localAuthCredentials')->where('userId', $userId)->first('mustChangePassword');

        return $row !== null && (int) $row->mustChangePassword === 1;
    }

    /** @return array{failedAttempts: int, lockedUntil: int|null} */
    public static function nextFailedLoginState(int $currentFailedAttempts, int $nowMs): array
    {
        $failedAttempts = $currentFailedAttempts + 1;
        $lockedUntil = $failedAttempts >= self::MAX_FAILED_ATTEMPTS ? $nowMs + self::LOCKOUT_MS : null;

        return ['failedAttempts' => $lockedUntil !== null ? 0 : $failedAttempts, 'lockedUntil' => $lockedUntil];
    }

    /**
     * Statuses match server/services/localAuth.ts, with reset_required added for
     * a credential that still holds a Node-era scrypt digest.
     *
     * @return array<string, mixed>
     */
    public static function attemptLogin(string $email, string $password, ?int $nowMs = null): array
    {
        $now = $nowMs ?? Dates::nowMillis();

        $record = DB::table('localAuthCredentials as c')
            ->join('users as u', 'u.id', '=', 'c.userId')
            ->where('c.emailNormalized', self::normaliseEmail($email))
            ->select('u.*', 'c.id as credentialId', 'c.passwordHash', 'c.passwordVersion',
                'c.mustChangePassword', 'c.failedAttempts', 'c.lockedUntil')
            ->first();

        // An unknown address and a suspended account answer identically, so the
        // response cannot be used to work out who holds an account.
        if ($record === null || $record->accountStatus !== 'active') {
            return ['status' => 'invalid'];
        }

        if ($record->lockedUntil !== null && (int) $record->lockedUntil > $now) {
            return ['status' => 'locked'];
        }

        if (self::isLegacyScryptHash((string) $record->passwordHash)) {
            return ['status' => 'reset_required'];
        }

        if (!self::verifyPassword($password, (string) $record->passwordHash)) {
            $next = self::nextFailedLoginState((int) $record->failedAttempts, $now);
            DB::table('localAuthCredentials')->where('id', $record->credentialId)->update([
                'failedAttempts' => $next['failedAttempts'],
                'lockedUntil' => $next['lockedUntil'],
                'lastFailedAt' => $now,
            ]);

            return $next['lockedUntil'] !== null ? ['status' => 'locked'] : ['status' => 'invalid'];
        }

        DB::table('localAuthCredentials')->where('id', $record->credentialId)->update([
            'failedAttempts' => 0,
            'lockedUntil' => null,
        ]);

        $user = (array) $record;
        foreach (['credentialId', 'passwordHash', 'passwordVersion', 'mustChangePassword', 'failedAttempts', 'lockedUntil'] as $key) {
            unset($user[$key]);
        }

        return [
            'status' => 'success',
            'user' => $user,
            'passwordVersion' => (int) $record->passwordVersion,
            'mustChangePassword' => (int) $record->mustChangePassword === 1,
        ];
    }

    /** @return array{passwordVersion: int, created: bool} */
    public static function createOrReplaceCredential(int $userId, string $email, string $password, bool $requireChangeOnNextLogin = false): array
    {
        $emailNormalized = self::normaliseEmail($email);
        $passwordHash = self::hashPassword($password);
        $now = Dates::nowMillis();

        $existing = DB::table('localAuthCredentials')->where('userId', $userId)->first(['id', 'passwordVersion']);

        if ($existing !== null) {
            $version = (int) $existing->passwordVersion + 1;
            DB::table('localAuthCredentials')->where('id', $existing->id)->update([
                'emailNormalized' => $emailNormalized,
                'passwordHash' => $passwordHash,
                'passwordVersion' => $version,
                'mustChangePassword' => $requireChangeOnNextLogin ? 1 : 0,
                'failedAttempts' => 0,
                'lockedUntil' => null,
                'lastPasswordChangedAt' => $now,
                'resetTokenHash' => null,
                'resetExpiresAt' => null,
                'resetUsedAt' => $now,
            ]);

            return ['passwordVersion' => $version, 'created' => false];
        }

        DB::table('localAuthCredentials')->insert([
            'userId' => $userId,
            'emailNormalized' => $emailNormalized,
            'passwordHash' => $passwordHash,
            'mustChangePassword' => $requireChangeOnNextLogin ? 1 : 0,
            'lastPasswordChangedAt' => $now,
        ]);

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
        $credential = DB::table('localAuthCredentials')->where('userId', $userId)->first('id');
        if ($credential === null) {
            throw TrpcException::badRequest('Local credential is not configured');
        }

        $token = self::createResetToken();
        $now = Dates::nowMillis();
        $expiresAt = $now + self::RESET_TTL_MS;

        DB::table('localAuthCredentials')->where('id', $credential->id)->update([
            'resetTokenHash' => self::hashResetToken($token),
            'resetExpiresAt' => $expiresAt,
            'resetUsedAt' => null,
        ]);

        return ['token' => $token, 'expiresAt' => $expiresAt];
    }

    /** @return array{userId: int}|null */
    public static function resetPassword(string $token, string $password): ?array
    {
        $passwordHash = self::hashPassword($password);
        $now = Dates::nowMillis();
        $tokenHash = self::hashResetToken($token);

        $credential = DB::table('localAuthCredentials')
            ->where('resetTokenHash', $tokenHash)
            ->where('resetExpiresAt', '>', $now)
            ->whereNull('resetUsedAt')
            ->first(['id', 'userId', 'passwordVersion']);

        if ($credential === null) {
            return null;
        }

        // The where clause repeats the token conditions so two simultaneous
        // redemptions of the same link cannot both succeed.
        $affected = DB::table('localAuthCredentials')
            ->where('id', $credential->id)
            ->whereNull('resetUsedAt')
            ->where('resetTokenHash', $tokenHash)
            ->update([
                'passwordHash' => $passwordHash,
                'passwordVersion' => (int) $credential->passwordVersion + 1,
                'mustChangePassword' => 0,
                'failedAttempts' => 0,
                'lockedUntil' => null,
                'lastPasswordChangedAt' => $now,
                'resetUsedAt' => $now,
                'resetTokenHash' => null,
                'resetExpiresAt' => null,
            ]);

        return $affected > 0 ? ['userId' => (int) $credential->userId] : null;
    }

    /**
     * Signs the version-bound session token. The Node server accepts it too,
     * because the claims and the HS256 secret are the ones
     * sdk.createLocalSessionToken uses.
     *
     * @param array<string, mixed> $user
     */
    public static function issueSession(array $user, int $passwordVersion): string
    {
        return Jwt::sign([
            'openId' => $user['openId'],
            'appId' => env('VITE_APP_ID') ?: 'local',
            'name' => $user['name'] ?: ($user['email'] ?: 'Hub user'),
            'authType' => 'local',
            'passwordVersion' => $passwordVersion,
        ], (string) env('JWT_SECRET'), time() + self::SESSION_TTL_SECONDS);
    }
}
