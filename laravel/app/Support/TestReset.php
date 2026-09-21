<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * The visible password-reset link for fictional training accounts, mirroring
 * server/services/testResetRules.ts.
 *
 * Showing a reset link on screen would normally be a way to take over any
 * account, so all three conditions have to hold: the address is in the reserved
 * test domain, the account is an active member of the training company, and it
 * is a member of no real company. An account that has ever been given
 * operational access is excluded, even if it still looks like a test account.
 */
final class TestReset
{
    public const ENTITY_NAME = 'TEST — Training Provider';
    public const EMAIL_SUFFIX = '.example.test';

    public static function isVisibleResetEligible(
        string $email,
        bool $hasActiveTestMembership,
        bool $hasActiveOperationalMembership,
    ): bool {
        return str_ends_with($email, self::EMAIL_SUFFIX)
            && $hasActiveTestMembership
            && !$hasActiveOperationalMembership;
    }

    /**
     * Issues a reset link to show on screen, or null when the account is not
     * eligible or no public URL is configured.
     *
     * @return array{url: string, expiresAt: int}|null
     */
    public static function createVisibleResetLink(int $userId, string $email): ?array
    {
        $publicUrl = trim((string) env('APP_PUBLIC_URL', ''));
        if ($publicUrl === '') {
            return null;
        }

        $membership = static fn (bool $isTestCompany) => DB::table('entityMemberships as m')
            ->join('entities as e', 'e.id', '=', 'm.entityId')
            ->where('m.userId', $userId)
            ->where('m.status', 'active')
            ->where('e.name', $isTestCompany ? '=' : '!=', self::ENTITY_NAME)
            ->first('m.id') !== null;

        if (!self::isVisibleResetEligible($email, $membership(true), $membership(false))) {
            return null;
        }

        $reset = LocalAuth::issuePasswordReset($userId);
        $url = rtrim($publicUrl, '/') . '/?resetToken=' . rawurlencode($reset['token']);

        Audit::write([
            'actorUserId' => $userId,
            'action' => 'auth.local.test_reset_link_displayed',
            'resourceType' => 'local_auth_credential',
            'resourceId' => $userId,
            'sensitivity' => 'restricted',
            'result' => 'success',
            'reasonCode' => 'fictional_test_account_only',
            'metadata' => ['expiresAt' => $reset['expiresAt']],
        ]);

        return ['url' => $url, 'expiresAt' => $reset['expiresAt']];
    }
}
