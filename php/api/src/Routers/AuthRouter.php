<?php
declare(strict_types=1);

namespace Hub\Routers;

use Hub\Audit;
use Hub\Context;
use Hub\Db;
use Hub\LocalAuth;
use Hub\Trpc;
use Hub\TrpcError;
use Hub\Users;

/**
 * The auth.* and localAuth.* procedures, mirroring the ones in server/routers.ts
 * and server/routers/localAuth.ts. These are the calls the SPA makes before it
 * can render anything, so they are the first ones ported.
 */
final class AuthRouter
{
    public static function register(Trpc $trpc): void
    {
        $trpc->query('auth.me', Trpc::PUBLIC, static function (Context $ctx): ?array {
            return $ctx->user === null ? null : Users::toSafeUser($ctx->user);
        });

        $trpc->query('auth.status', Trpc::PUBLIC, static function (Context $ctx): array {
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

        $trpc->mutation('auth.logout', Trpc::PUBLIC, static function (Context $ctx): array {
            $ctx->clearSessionCookie();

            return ['success' => true];
        });

        $trpc->query('localAuth.bootstrapStatus', Trpc::PUBLIC, static function (): array {
            $existing = Db::first('SELECT id FROM localAuthCredentials LIMIT 1');

            return ['setupAvailable' => $existing === null];
        });

        $trpc->mutation('localAuth.login', Trpc::PUBLIC, static function (Context $ctx, mixed $input): array {
            $email = self::requireEmail($input['email'] ?? null);
            $password = self::requirePassword($input['password'] ?? null);

            $result = LocalAuth::attemptLogin($email, $password);

            // Every failure answers with one message. Distinguishing "no such
            // account" from "wrong password" here would turn the sign-in form
            // into a way to find out who has an account.
            if ($result['status'] !== 'success') {
                throw TrpcError::unauthorized(
                    'Unable to sign in with those details. Check the email and password, or contact your administrator.'
                );
            }

            $ctx->setSessionCookie(
                LocalAuth::issueSession($result['user'], $result['passwordVersion']),
                365 * 24 * 60 * 60
            );

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
    }

    private static function requireEmail(mixed $value): string
    {
        if (!is_string($value)) {
            throw TrpcError::badRequest('Enter an email address.');
        }

        $email = trim($value);
        if ($email === '' || strlen($email) > 320 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            throw TrpcError::badRequest('Enter a valid email address.');
        }

        return $email;
    }

    private static function requirePassword(mixed $value): string
    {
        if (!is_string($value) || $value === '' || strlen($value) > 256) {
            throw TrpcError::badRequest('Enter your password.');
        }

        return $value;
    }
}
