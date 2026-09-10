# Guest Invitations and Passwordless Sign-In

## Purpose

The Hub now offers two distinct, secure entry mechanisms. **Passwordless secure sign-in** remains the normal route for staff and uses the configured identity provider through the existing nonce-bound OAuth flow. **Guest invitations** are deliberately narrower: a company administrator can create a time-limited, revocable link for a single property’s basic summary. A guest invitation does not create a Hub user account, entity membership, operational role or reusable session.

| Mechanism | Who can use it | What it allows | What it never allows |
|---|---|---|---|
| Passwordless secure sign-in | Approved staff authenticated by the identity provider | Normal server-authorised role, company, property and placement access | Direct Hub password storage, local password resets, or bypass of tenant/role checks |
| Guest invitation | Anyone holding a valid, unrevoked invitation | One selected property’s read-only basic summary | Young-person or placement data; safeguarding, health, HR, rota, finance, documents, audit records, admin controls or another company’s information |

## Operating Guest Invitations

Company administrators open **Access control** and choose **Create guest link**. They select one property, optionally add a recipient label, select a 24-hour, 3-day or 7-day expiry, and limit the link to one, three or five opens. The page displays the new link only once; administrators should copy it immediately and send it only through an approved channel.

The Hub stores only a SHA-256 hash of the opaque 32-byte token. The plaintext token is neither persisted nor included in audit metadata. Expiry, revocation, use count and property/entity linkage are checked by the server whenever the link is redeemed. Creation, redemption, revocation and denied redemption attempts are recorded to the restricted, hash-linked audit trail.

Administrators can revoke an active link from the same Access control panel. Revocation takes effect immediately. A guest sees one generic unavailable message for a missing, expired, revoked or exhausted link, so the response does not disclose tenant, property or invitation information.

## Passwordless Sign-In Boundaries

The Hub delegates identity verification to its configured identity provider; it does not store a password or implement its own reset mechanism. The sign-in entry point preserves the existing browser-bound one-time nonce, callback-state validation and fixed in-app return route. Organisations must configure a passwordless option with their identity provider if they require email magic links, passkeys or a similar method; this implementation does **not** claim to send email magic links itself.

Browsers that block required cookies, including Safari Private Browsing and strict tracking/privacy modes, may prevent the identity-provider sign-in flow from completing. The sign-in page provides safe provider recovery and support-request routes without exposing credentials, raw provider hostnames, tenant details or session diagnostics.

## Security Review Checklist

| Control | Verification status |
|---|---|
| Company-admin-only creation, list and revocation | Enforced through the canonical `config.write` capability check |
| Tenant and property scope validation | Property must belong to the selected entity before invitation creation |
| Opaque, non-plaintext token persistence | Stored as a one-way SHA-256 hash only |
| Expiry, revocation and bounded-use enforcement | Server-side, including an atomic conditional use-count update |
| Sensitive-domain exclusion | Guest endpoint returns only an allowlisted property summary payload |
| Audit evidence without token disclosure | Restricted create, redeem, revoke and denial events are recorded |
| Passwordless sign-in integrity | Existing nonce-bound identity-provider flow preserved |

## Support Handling

If a recipient cannot open a link, issue a new one rather than attempting to diagnose whether it was valid. If a company needs a broader external-sharing use case, complete a data-sharing assessment and build a separately scoped, role-reviewed workflow. Do not reuse guest invitations for care records, invoices, HR evidence, safeguarding information or the document library.
