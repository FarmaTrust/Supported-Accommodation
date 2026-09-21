<?php

declare(strict_types=1);

namespace App\Trpc\Routers;

use App\Support\Audit;
use App\Support\Dates;
use App\Support\LocalAuth;
use App\Support\ResetEmail;
use App\Support\Users;
use App\Trpc\Context;
use App\Trpc\Registry;
use App\Trpc\TrpcException;
use App\Trpc\Validate;
use Illuminate\Support\Facades\DB;

/**
 * auth.* and localAuth.*, mirroring server/routers.ts and
 * server/routers/localAuth.ts.
 *
 * These are the calls the SPA makes before it can render anything, so they are
 * the first ones ported.
 */
final class AuthRouter
{
    public static function register(Registry $registry): void
    {
        $registry->query('auth.me', Registry::PUBLIC, static function (Context $ctx): ?array {
            return $ctx->user === null ? null : Users::toSafeUser($ctx->user);
        });

        $registry->query('auth.status', Registry::PUBLIC, static function (Context $ctx): array {
            $user = $ctx->user;

            if ($user === null) {
                return [
                    'user' => null,
                    'issue' => $ctx->authIssue,
                    'passwordChangeRequired' => false,
                    'phoneCaptureRequired' => false,
                ];
            }

            return [
                'user' => Users::toSafeUser($user),
                'issue' => null,
                'passwordChangeRequired' => LocalAuth::requiresPasswordChange((int) $user['id']),
                'phoneCaptureRequired' => empty($user['phone']) || empty($user['phoneCapturedAt']),
            ];
        });

        $registry->mutation('auth.logout', Registry::PUBLIC, static function (Context $ctx): array {
            $ctx->clearSessionCookie();

            return ['success' => true];
        });

        $registry->query('localAuth.bootstrapStatus', Registry::PUBLIC, static function (): array {
            return ['setupAvailable' => DB::table('localAuthCredentials')->limit(1)->first() === null];
        });

        $registry->mutation('localAuth.login', Registry::PUBLIC, static function (Context $ctx, mixed $input): array {
            $email = Validate::email($input['email'] ?? null);
            $password = Validate::password($input['password'] ?? null);

            $result = LocalAuth::attemptLogin($email, $password);

            // Every failure answers with one message. Telling "no such account"
            // apart from "wrong password" would turn the sign-in form into a way
            // to find out who holds an account.
            if ($result['status'] !== 'success') {
                throw self::signInFailure();
            }

            $ctx->setSessionCookie(LocalAuth::issueSession($result['user'], $result['passwordVersion']));

            Audit::write([
                'actorUserId' => (int) $result['user']['id'],
                'action' => 'auth.local.login',
                'resourceType' => 'session',
                'resourceId' => (int) $result['user']['id'],
                'sensitivity' => 'restricted',
                'result' => 'success',
                'reasonCode' => 'email_password_verified',
            ]);

            return ['success' => true, 'mustChangePassword' => $result['mustChangePassword']];
        });

        $registry->mutation('localAuth.bootstrapOwner', Registry::PUBLIC, static function (Context $ctx, mixed $input): array {
            $email = Validate::email($input['email'] ?? null);
            $password = Validate::password($input['password'] ?? null);
            $supplied = $input['bootstrapToken'] ?? null;

            $configured = (string) env('LOCAL_AUTH_BOOTSTRAP_TOKEN', '');
            if ($configured === '' || !is_string($supplied) || !hash_equals($configured, $supplied)) {
                throw self::signInFailure();
            }

            // This token establishes the first local credential only. Later
            // changes go through the authenticated or administrator paths, which
            // are separately audited.
            if (DB::table('localAuthCredentials')->limit(1)->first() !== null) {
                throw self::signInFailure();
            }

            $user = Users::byEmail($email);
            if ($user === null) {
                throw self::signInFailure();
            }

            $resolved = Users::withResolvedRole($user);
            if ($resolved['role'] !== 'admin' && $resolved['operationalRole'] !== 'owner') {
                throw self::signInFailure();
            }

            $result = LocalAuth::createOrReplaceCredential((int) $user['id'], $email, $password);
            $ctx->setSessionCookie(LocalAuth::issueSession($user, $result['passwordVersion']));

            Audit::write([
                'actorUserId' => (int) $user['id'],
                'action' => 'auth.local.owner_bootstrap',
                'resourceType' => 'local_auth_credential',
                'resourceId' => (int) $user['id'],
                'sensitivity' => 'restricted',
                'result' => 'success',
                'reasonCode' => $result['created'] ? 'initial_owner_credential' : 'owner_credential_rotated',
            ]);

            return ['success' => true];
        });

        $registry->mutation('localAuth.requestPasswordReset', Registry::PUBLIC, static function (Context $ctx, mixed $input): array {
            $email = Validate::email($input['email'] ?? null);
            $user = Users::byEmail($email);
            $deliveryEnabled = ResetEmail::isConfigured();

            // The reply is identical whether or not the address is known.
            if ($user !== null && $user['email']) {
                if ($deliveryEnabled) {
                    $reset = LocalAuth::issuePasswordReset((int) $user['id']);
                    $delivery = ResetEmail::send((string) $user['email'], $reset['token']);
                    Audit::write([
                        'actorUserId' => (int) $user['id'],
                        'action' => 'auth.local.reset_requested',
                        'resourceType' => 'local_auth_credential',
                        'resourceId' => (int) $user['id'],
                        'sensitivity' => 'restricted',
                        'result' => $delivery['delivered'] ? 'success' : 'failure',
                        'reasonCode' => $delivery['delivered'] ? 'email_reset_link_sent' : ($delivery['reason'] ?? 'provider_rejected'),
                    ]);
                } else {
                    Audit::write([
                        'actorUserId' => (int) $user['id'],
                        'action' => 'auth.local.reset_requested',
                        'resourceType' => 'local_auth_credential',
                        'resourceId' => (int) $user['id'],
                        'sensitivity' => 'restricted',
                        'result' => 'failure',
                        'reasonCode' => 'email_provider_not_configured',
                    ]);
                }
            }

            return [
                'success' => true,
                'emailDeliveryEnabled' => $deliveryEnabled,
                'testingResetUrl' => null,
                'message' => $deliveryEnabled
                    ? 'If the account is eligible, a password-reset link has been sent. Check your email or contact your company administrator.'
                    : 'Password-reset email is disabled for testing. Contact your company administrator to issue a temporary password.',
            ];
        });

        $registry->mutation('localAuth.resetPassword', Registry::PUBLIC, static function (Context $ctx, mixed $input): array {
            $token = Validate::token($input['token'] ?? null, 'This password reset link is invalid or has expired.');
            $password = Validate::password($input['password'] ?? null);

            $reset = LocalAuth::resetPassword($token, $password);
            if ($reset === null) {
                throw TrpcException::badRequest('This password reset link is invalid or has expired.');
            }

            Audit::write([
                'actorUserId' => $reset['userId'],
                'action' => 'auth.local.reset_completed',
                'resourceType' => 'local_auth_credential',
                'resourceId' => $reset['userId'],
                'sensitivity' => 'restricted',
                'result' => 'success',
                'reasonCode' => 'one_time_reset_consumed',
            ]);

            return ['success' => true];
        });

        $registry->mutation('localAuth.setMyPassword', Registry::CREDENTIAL, static function (Context $ctx, mixed $input): array {
            $user = $ctx->requireUser();
            if (empty($user['email'])) {
                throw TrpcException::badRequest('A verified email address is required before setting a local password.');
            }
            $password = Validate::password($input['password'] ?? null);

            $result = LocalAuth::createOrReplaceCredential((int) $user['id'], (string) $user['email'], $password);

            // The new passwordVersion retires every session issued before this
            // change, so the caller is handed a fresh cookie straight away.
            $ctx->setSessionCookie(LocalAuth::issueSession($user, $result['passwordVersion']));

            Audit::write([
                'actorUserId' => (int) $user['id'],
                'action' => 'auth.local.password_set',
                'resourceType' => 'local_auth_credential',
                'resourceId' => (int) $user['id'],
                'sensitivity' => 'restricted',
                'result' => 'success',
                'reasonCode' => $result['created'] ? 'local_credential_created' : 'local_password_changed',
            ]);

            return ['success' => true];
        });

        $registry->mutation('localAuth.captureMyPhone', Registry::USER, static function (Context $ctx, mixed $input): array {
            $user = $ctx->requireUser();
            $phone = Validate::phone($input['phone'] ?? null);

            DB::table('users')->where('id', (int) $user['id'])->update([
                'phone' => $phone,
                'phoneCapturedAt' => Dates::nowMillis(),
            ]);

            Audit::write([
                'actorUserId' => (int) $user['id'],
                'action' => 'user_profile.phone_capture',
                'resourceType' => 'user',
                'resourceId' => (int) $user['id'],
                'sensitivity' => 'restricted',
                'result' => 'success',
                // The number itself never enters the audit trail.
                'metadata' => ['phoneLength' => strlen($phone), 'firstCapture' => empty($user['phoneCapturedAt'])],
            ]);

            return ['success' => true];
        });
    }

    private static function signInFailure(): TrpcException
    {
        return TrpcException::unauthorized(
            'Unable to sign in with those details. Check the email and password, or contact your administrator.'
        );
    }
}
