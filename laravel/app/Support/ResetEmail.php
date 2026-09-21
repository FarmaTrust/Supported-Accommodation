<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\Http;
use Throwable;

/**
 * Password-reset delivery through Resend, mirroring
 * server/services/resetEmail.ts.
 *
 * Delivery stays off unless an API key, a sender that looks like an address and
 * an https public URL are all configured. The caller treats "not configured" as
 * an ordinary outcome rather than a failure, so a deployment without email still
 * lets an administrator issue a temporary password by hand.
 */
final class ResetEmail
{
    public static function isConfigured(): bool
    {
        $sender = trim((string) env('RESET_EMAIL_FROM', ''));
        $publicUrl = (string) env('APP_PUBLIC_URL', '');

        return (string) env('RESEND_API_KEY', '') !== ''
            && preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/', $sender) === 1
            && preg_match('#^https://\S+$#i', $publicUrl) === 1;
    }

    /** @return array{delivered: bool, reason?: string} */
    public static function send(string $email, string $token): array
    {
        if (!self::isConfigured()) {
            return ['delivered' => false, 'reason' => 'provider_not_configured'];
        }

        $resetUrl = rtrim((string) env('APP_PUBLIC_URL'), '/') . '/?resetToken=' . rawurlencode($token);

        try {
            $response = Http::withToken((string) env('RESEND_API_KEY'))
                ->timeout(15)
                ->post('https://api.resend.com/emails', [
                    'from' => trim((string) env('RESET_EMAIL_FROM')),
                    'to' => [$email],
                    'subject' => 'Reset your Supported Accommodation Hub password',
                    'text' => "A password reset was requested for your Supported Accommodation Hub account. "
                        . "Use this one-time link within one hour: $resetUrl\n\n"
                        . 'If you did not request this, you can ignore this email.',
                ]);
        } catch (Throwable $error) {
            // A provider outage must not stop the caller answering; the generic
            // reply is the same either way.
            report($error);

            return ['delivered' => false, 'reason' => 'provider_unreachable'];
        }

        return $response->successful()
            ? ['delivered' => true]
            : ['delivered' => false, 'reason' => 'provider_rejected'];
    }
}
