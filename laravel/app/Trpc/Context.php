<?php

declare(strict_types=1);

namespace App\Trpc;

use App\Support\Jwt;
use App\Support\LocalAuth;
use App\Support\Users;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Cookie;

/**
 * Per-request authentication state, mirroring server/_core/context.ts.
 *
 * Authentication is optional here on purpose: public procedures still run for an
 * anonymous caller, and the guards in Registry decide what a missing user means.
 * A session that fails to verify sets authIssue so the client can show a stable
 * reason, without this layer ever revealing which part of the check failed.
 */
final class Context
{
    public const COOKIE_NAME = 'app_session_id';

    /** @var array<int, Cookie> */
    private array $queuedCookies = [];

    /** @param array<string, mixed>|null $user */
    private function __construct(
        public readonly Request $request,
        public readonly ?array $user,
        public readonly ?string $authIssue,
    ) {
    }

    public static function fromRequest(Request $request): self
    {
        $token = $request->cookie(self::COOKIE_NAME);

        if (!is_string($token) || $token === '') {
            // The Preview client falls back to a bearer token when the browser
            // refuses third-party cookies, so the header is honoured too.
            $header = (string) $request->header('Authorization', '');
            $token = str_starts_with($header, 'Bearer ') ? substr($header, 7) : null;
        }

        if (!is_string($token) || $token === '') {
            return new self($request, null, null);
        }

        $claims = Jwt::verify($token, (string) env('JWT_SECRET'));
        if ($claims === null) {
            return new self($request, null, 'AUTH_SESSION_INVALID');
        }

        // Only local sessions remain; the Node server retires anything else.
        if (($claims['authType'] ?? null) !== 'local' || !is_string($claims['openId'] ?? null)) {
            return new self($request, null, 'AUTH_SESSION_INVALID');
        }

        $user = Users::byOpenId($claims['openId']);
        if ($user === null) {
            return new self($request, null, 'AUTH_SESSION_INVALID');
        }

        // A password change bumps passwordVersion, which retires every session
        // issued before it. Without this check a stolen cookie would outlive the
        // password reset meant to revoke it.
        $version = $claims['passwordVersion'] ?? null;
        if (!is_int($version) || !LocalAuth::sessionIsCurrent((int) $user['id'], $version)) {
            return new self($request, null, 'AUTH_SESSION_INVALID');
        }

        return new self($request, Users::withResolvedRole($user), null);
    }

    /** @return array<string, mixed> */
    public function requireUser(): array
    {
        if ($this->user === null) {
            throw TrpcException::unauthorized('Sign in to continue.');
        }

        return $this->user;
    }

    public function userId(): int
    {
        return (int) $this->requireUser()['id'];
    }

    public function isSecure(): bool
    {
        return $this->request->isSecure()
            || strtolower((string) $this->request->header('X-Forwarded-Proto')) === 'https';
    }

    public function setSessionCookie(string $token): void
    {
        $this->queuedCookies[] = $this->cookie($token, LocalAuth::SESSION_TTL_SECONDS);
    }

    public function clearSessionCookie(): void
    {
        $this->queuedCookies[] = $this->cookie('', -3600);
    }

    /** @return array<int, Cookie> */
    public function queuedCookies(): array
    {
        return $this->queuedCookies;
    }

    private function cookie(string $value, int $maxAge): Cookie
    {
        $secure = $this->isSecure();

        return new Cookie(
            name: self::COOKIE_NAME,
            value: $value,
            expire: $maxAge === 0 ? 0 : time() + $maxAge,
            path: '/',
            domain: null,
            secure: $secure,
            httpOnly: true,
            raw: false,
            // Matches getSessionCookieOptions: the app is embedded in an iframe
            // in production, which needs SameSite=None, but None without Secure
            // is rejected outright over plain http during development.
            sameSite: $secure ? Cookie::SAMESITE_NONE : Cookie::SAMESITE_LAX,
        );
    }
}
