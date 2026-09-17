# MySQL Email-and-Password Authentication Operations

## Scope

This release replaces the previous passwordless entry point with **local email-and-password authentication**. User credentials are maintained in the `localAuthCredentials` MySQL table, linked one-to-one to the existing `users` record. The table holds a normalised email, a salted scrypt password hash, failed-login state, a short lockout timestamp and hashed one-time reset-token state. It never holds plaintext passwords or plaintext password-reset tokens.

| Control | Operational behaviour |
|---|---|
| Password storage | `scrypt` with a unique random salt and memory-hard parameters; plaintext is discarded before persistence. |
| Password policy | At least 14 characters, no control characters and at least three character classes. |
| Failed sign-in | Generic sign-in error to prevent account enumeration; five consecutive failures cause a 15-minute lockout. |
| Session revocation | Password changes increment `passwordVersion`; prior local sessions fail server-side validation. |
| Reset link | Company administrators create a single-use link which expires after one hour and is stored only as a hash. |
| Temporary sign-in link | Company administrators can create one single-use, revocable link for an existing active local account in their selected company, for one to 30 days. It is stored only as a hash and opens a standard version-bound local session. |
| Audit | Credential issuance, owner bootstrap, sign-in, reset request, reset issue, reset completion and password changes create restricted audit events. |

## Initial Owner Setup

Before deploying a fresh environment, supply a high-entropy `LOCAL_AUTH_BOOTSTRAP_TOKEN` using the secure project configuration facility. The approved initial owner selects **First owner setup** on the sign-in page, enters their registered email address, a strong password and the one-time bootstrap token. The flow validates that the email already belongs to an approved owner/admin account, stores only the password hash, creates a secure session and writes a restricted audit event. The setup action is available only while no local credential exists; the server also refuses it once the first credential has been created.

The bootstrap token must be rotated or removed after successful initial setup. It is not a user password, must not be distributed to colleagues and must not be stored in source control. A generic `UNAUTHORIZED` response from `bootstrapOwner` means the one-time token was unavailable or did not match, the nominated account was not an Owner/admin account, or setup had already completed; the response intentionally does not disclose which condition applied. Later accounts use the normal email/password sign-in route after their approved local credential and explicit company memberships have been created.

## Colleague Provisioning and Recovery

Company administrators must first create a company-scoped colleague pre-authorisation with a role, explicit property scope, expiry and business reason. In **Access control**, they then issue a strong temporary password. The server refuses to create a local credential unless the email has an active membership or pending approved pre-authorisation in the selected company.

Password reset requests always return a generic message. This prevents the sign-in screen from confirming whether an email is registered. A company administrator can generate a one-time reset link for an active company member, records the mandatory business reason, then distributes the link only through an approved channel. The Hub intentionally does not send reset emails until a separately assessed and configured email-delivery provider is available.

### Fictional TEST Account Recovery

Routine fictional-scenario maintenance preserves an existing fictional TEST account credential and its password version. It may create a missing credential, but it must **not** rotate an existing one. A credential reset is an explicit recovery operation only; it uses the same salted local-authentication service, clears failed-attempt state, invalidates prior sessions through the password version, and records a restricted audit event. No TEST password is stored in application source, scenario files or audit metadata.

For a fictional `*.example.test` account with an active TEST membership and no operational-company membership, select **Forgot password?**, enter the account email and use the visible single-use TEST reset link. The canonical link parameter is `resetToken`; the sign-in page also accepts the legacy `reset` parameter so previously issued TEST recovery links continue to open the password-change form. The reset link is valid for one hour, is stored only as a hash and can be used once. Accounts with an operational membership remain outside this testing-only visible-link exception and use the normal administrator-controlled recovery flow.

### Temporary Sign-in Links

In **Access control**, a company administrator can issue an account-specific temporary sign-in link to an existing active member with local credentials. The administrator chooses the recipient from the current company, selects an expiry of one, seven, fourteen or up to thirty days, and records a business reason. The link is visible only in the creation dialog so it must be copied and distributed through an approved secure channel; the database and audit trail retain only a one-way token hash and lifecycle metadata.

Redemption does not create an account and does not grant or snapshot any role, property, placement or tenant scope. The service checks the recipient’s current account status, unexpired active membership in the issuing company, lockout state and current local credential before atomically consuming the link. It then issues the same version-bound HTTP-only session as password sign-in. A required first-login password change still blocks operational routes until completed. New links supersede earlier unused links for the same recipient and company. An administrator may revoke an unused link with a reason; after redemption, use the normal password reset or account-suspension procedures to invalidate access.

## Deployment Requirements

Use a unique `JWT_SECRET` for each environment and enforce HTTPS at the public edge. Production session cookies are HTTP-only, Secure and `SameSite=None`; local HTTP development uses `SameSite=Lax` to remain usable without weakening production settings. Use a non-production MySQL/TiDB database for development and never transfer operational data or production credential hashes into it.

> Local database administration is not a substitute for the Hub’s authorisation layer. Do not grant roles, tenant membership or credentials through raw SQL except under a documented incident procedure; use the audited application workflows instead.

## Workforce Evidence, Care Templates and Reminders

Managers and Owners can review **submitted certificate and sickness requests** from the Manager App. The review queue opens the controlled attachment and records an independent decision. A request may be approved, returned for correction, or rejected; return and rejection decisions require a clear reason and are audit logged. Submitters cannot approve their own request. Evidence bytes remain in object storage, while the Hub retains only governed document metadata and version records.

Managers and Owners can also create entity-scoped health, medication, and curfew routine templates in the Manager App. These templates are operational prompts rather than clinical prescriptions. Key Workers can select an approved template only while working an authorised placement, and can amend the copied text before saving the individual placement record. The record preserves the selected template identifier and version for later audit without granting template access across entities.

Evidence reminders are configured in the Manager App. The setting defines the maximum review time for pending workforce evidence and lead times for document and retention reviews. Saving **enabled** settings creates or updates one managed daily Heartbeat task for that entity; it does not run an in-process timer. Each notification is deduplicated, contains generic content, and routes only to authorised manager/owner accounts. Disable the setting to pause the existing task; re-enable it to resume the same task. Do not configure production reminder delivery until the entity’s accountable manager and notification routing have been verified.
