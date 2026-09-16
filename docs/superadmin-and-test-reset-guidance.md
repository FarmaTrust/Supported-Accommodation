# Superadmin Dashboard and TEST Reset Guidance

## Scope and operational boundary

The Superadmin dashboard is a **restricted platform-monitoring view**. It is available only when the authenticated user has both `role = admin` and `operationalRole = platform_admin`. The server enforces this requirement before returning data and writes an audit event when the view is accessed.

The dashboard returns **metadata only**: company status and active-member count; user name, email, account state, role and recent sign-in time; and platform totals. It does not return young-person, placement, safeguarding, health, incident, workforce-sensitive, invoice, statement, bank, document-content or audit-log data. It does not alter the tenant, property or placement checks on any other endpoint.

## TEST-only visible password reset

Visible reset links are permitted only as a testing aid for a fictional account that meets every condition below.

- The email ends in `.example.test`.
- The account has an active membership in `TEST — Training Provider`.
- The account has **no** active membership in any operational company.
- The fixed public HTTPS application URL is configured.

When all conditions pass, the reset request can display a copyable, one-time reset link on screen. The token is still random, hashed in storage, expires after one hour and is recorded in restricted audit evidence without the token value. A production account, including any account that also belongs to an operational company, never receives an on-screen link. Production reset-email delivery remains disabled until a verified Farmatrust sender and server-only provider API key are configured.

## Fictional account convention

The display account name **Guest** uses the email-format sign-in identifier `guest@training-provider.example.test`. It has an active read-only membership in the fictional TEST company only, has no operational-company memberships, and is required to change its temporary credential on first sign-in. Do not use TEST credentials for operational accounts or create an account called Guest in a live company.

## Implementation checklist

- Keep the Superadmin API behind the explicit dual-role check; do not authorise it by UI visibility alone.
- Keep Superadmin monitoring payloads metadata-only unless a separate, reviewed break-glass workflow exists.
- Keep visible reset links restricted to fictional TEST accounts; never introduce a configuration switch that exposes a production reset token in the browser.
- Require a new password on first sign-in for all temporary accounts, and remove TEST accounts before production data is introduced.
