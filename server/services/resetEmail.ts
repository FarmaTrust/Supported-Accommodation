import { ENV } from "../_core/env";

type ResetEmailInput = { email: string; token: string };

function isVerifiedSender(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function isPasswordResetEmailConfigured(config = ENV) {
  return Boolean(config.resendApiKey && isVerifiedSender(config.resetEmailFrom) && /^https:\/\/[^\s]+$/i.test(config.appPublicUrl));
}

export function buildResetEmail(input: ResetEmailInput, config = ENV) {
  if (!isPasswordResetEmailConfigured(config)) return null;
  const resetUrl = new URL("/", config.appPublicUrl);
  resetUrl.searchParams.set("resetToken", input.token);
  return {
    url: "https://api.resend.com/emails",
    headers: { Authorization: `Bearer ${config.resendApiKey}`, "Content-Type": "application/json" },
    body: {
      from: config.resetEmailFrom,
      to: [input.email],
      subject: "Reset your Supported Accommodation Hub password",
      text: `A password reset was requested for your Supported Accommodation Hub account. Use this one-time link within one hour: ${resetUrl.toString()}\n\nIf you did not request this, you can ignore this email.`,
    },
  };
}

export async function sendPasswordResetEmail(input: ResetEmailInput) {
  const email = buildResetEmail(input);
  if (!email) return { delivered: false as const, reason: "provider_not_configured" as const };
  const response = await fetch(email.url, { method: "POST", headers: email.headers, body: JSON.stringify(email.body) });
  if (!response.ok) return { delivered: false as const, reason: "provider_rejected" as const };
  return { delivered: true as const };
}
