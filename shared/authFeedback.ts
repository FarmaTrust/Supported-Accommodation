export const AUTH_FEEDBACK_CODES = [
  "AUTH_SIGN_IN_REQUIRED",
  "AUTH_SESSION_INVALID",
  "AUTH_SIGN_IN_INCOMPLETE",
  "AUTH_SIGN_IN_EXPIRED",
  "AUTH_PROVIDER_REJECTED",
  "AUTH_SIGN_IN_FAILED",
  "AUTH_SERVICE_UNAVAILABLE",
  "AUTH_ACCESS_DENIED",
  "AUTH_NO_WORKSPACE_ACCESS",
] as const;

export type AuthFeedbackCode = (typeof AUTH_FEEDBACK_CODES)[number];

export type AuthFeedback = {
  code: AuthFeedbackCode;
  title: string;
  message: string;
  actionLabel: string;
};

const AUTH_FEEDBACK: Record<AuthFeedbackCode, AuthFeedback> = {
  AUTH_SIGN_IN_REQUIRED: {
    code: "AUTH_SIGN_IN_REQUIRED",
    title: "Sign in required",
    message: "Sign in securely to continue to your assigned workspace.",
    actionLabel: "Sign in securely",
  },
  AUTH_SESSION_INVALID: {
    code: "AUTH_SESSION_INVALID",
    title: "Your session needs to be renewed",
    message: "Your secure session has ended or could not be verified. Sign in again to continue.",
    actionLabel: "Sign in again",
  },
  AUTH_SIGN_IN_INCOMPLETE: {
    code: "AUTH_SIGN_IN_INCOMPLETE",
    title: "Sign-in was not completed",
    message: "We did not receive everything needed to complete your sign-in. Start again and keep this window open until you return.",
    actionLabel: "Start sign-in again",
  },
  AUTH_SIGN_IN_EXPIRED: {
    code: "AUTH_SIGN_IN_EXPIRED",
    title: "Sign-in link expired",
    message: "For your security, this sign-in attempt can no longer be used. Start a new sign-in.",
    actionLabel: "Start a new sign-in",
  },
  AUTH_PROVIDER_REJECTED: {
    code: "AUTH_PROVIDER_REJECTED",
    title: "Sign-in was not accepted",
    message: "Your sign-in provider did not accept the details or verification supplied. Check them there, then try again.",
    actionLabel: "Try signing in again",
  },
  AUTH_SIGN_IN_FAILED: {
    code: "AUTH_SIGN_IN_FAILED",
    title: "We could not sign you in",
    message: "Please try again. If this continues, contact your company administrator or support team with the code below.",
    actionLabel: "Try signing in again",
  },
  AUTH_SERVICE_UNAVAILABLE: {
    code: "AUTH_SERVICE_UNAVAILABLE",
    title: "Sign-in check is temporarily unavailable",
    message: "We could not verify your secure session right now. Check your connection and try again shortly.",
    actionLabel: "Try again",
  },
  AUTH_ACCESS_DENIED: {
    code: "AUTH_ACCESS_DENIED",
    title: "You do not have authority to access this information",
    message: "Your account is signed in, but your current role or property access does not allow this action. Ask a company administrator to review your access.",
    actionLabel: "Return to your workspace",
  },
  AUTH_NO_WORKSPACE_ACCESS: {
    code: "AUTH_NO_WORKSPACE_ACCESS",
    title: "No company access has been assigned",
    message: "Your account is signed in, but it has not been assigned to a company workspace. Ask a company administrator to add you before continuing.",
    actionLabel: "Sign out",
  },
};

export function isAuthFeedbackCode(value: string | null | undefined): value is AuthFeedbackCode {
  return Boolean(value && (AUTH_FEEDBACK_CODES as readonly string[]).includes(value));
}

export function getAuthFeedback(code: AuthFeedbackCode): AuthFeedback {
  return AUTH_FEEDBACK[code];
}
