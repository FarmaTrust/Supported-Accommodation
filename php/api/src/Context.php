<?php
declare(strict_types=1);

namespace Hub;

/**
 * Per-request authentication state, mirroring server/_core/context.ts.
 *
 * Authentication is deliberately optional here: public procedures still run for
 * an anonymous caller, and the guards in Trpc decide what a missing user means.
 * A session that fails to verify sets authIssue so the client can show a stable
 * reason without this layer ever leaking which part of the check failed.
 */
final class Context
{
    public const COOKIE_NAME = 'app_session_id';

    /** @param array<string, mixed>|null $user */
    private function __construct(
        public readonly ?array $user,
        public readonly ?string $authIssue,
        public readonly array $cookies,
        public readonly bool $isSecure,
    ) {
    }

    public static function fromRequest(): self
    {
        $cookies = $_COOKIE;
        $isSecure = self::requestIsSecure();

        $token = $cookies[self::COOKIE_NAME] ?? null;
        if (!is_string($token) || $token === '') {
            // The Preview client falls back to a bearer token when the browser
            // refuses third-party cookies, so the header is honoured too.
            $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
            $token = is_string($header) && str_starts_with($header, 'Bearer ') ? substr($header, 7) : null;
        }

        $hadSessionSignal = is_string($token) && $token !== '';
        if (!$hadSessionSignal) {
            return new self(null, null, $cookies, $isSecure);
        }

        $claims = Jwt::verify($token, Env::require('JWT_SECRET'));
        if ($claims === null) {
            return new self(null, 'AUTH_SESSION_INVALID', $cookies, $isSecure);
        }

        // Only local sessions remain; the Node server retires anything else.
        if (($claims['authType'] ?? null) !== 'local' || !is_string($claims['openId'] ?? null)) {
            return new self(null, 'AUTH_SESSION_INVALID', $cookies, $isSecure);
        }

        $user = Users::byOpenId($claims['openId']);
        if ($user === null) {
            return new self(null, 'AUTH_SESSION_INVALID', $cookies, $isSecure);
        }

        // A password change bumps passwordVersion, which retires every session
        // issued before it. Without this check a stolen cookie would outlive
        // the password reset meant to revoke it.
        $version = $claims['passwordVersion'] ?? null;
        if (!is_int($version) || !LocalAuth::sessionIsCurrent((int) $user['id'], $version)) {
            return new self(null, 'AUTH_SESSION_INVALID', $cookies, $isSecure);
        }

        return new self(Users::withResolvedRole($user), null, $cookies, $isSecure);
    }

    private static function requestIsSecure(): bool
    {
        if (($_SERVER['HTTPS'] ?? '') !== '' && strtolower((string) $_SERVER['HTTPS']) !== 'off') {
            return true;
        }

        $forwarded = $_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '';
        foreach (explode(',', (string) $forwarded) as $proto) {
            if (strtolower(trim($proto)) === 'https') {
                return true;
            }
        }

        return false;
    }

    public function setSessionCookie(string $token, int $maxAgeSeconds): void
    {
        setcookie(self::COOKIE_NAME, $token, $this->cookieOptions($maxAgeSeconds));
    }

    public function clearSessionCookie(): void
    {
        setcookie(self::COOKIE_NAME, '', $this->cookieOptions(-3600));
    }

    /** @return array<string, mixed> */
    private function cookieOptions(int $maxAgeSeconds): array
    {
        return [
            'expires' => time() + $maxAgeSeconds,
            'path' => '/',
            'httponly' => true,
            'secure' => $this->isSecure,
            // Matches getSessionCookieOptions: the app is embedded in an iframe
            // in production, which requires SameSite=None, but None without
            // Secure is rejected outright over plain http during development.
            'samesite' => $this->isSecure ? 'None' : 'Lax',
        ];
    }
}
