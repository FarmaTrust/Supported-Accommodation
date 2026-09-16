# Guest Invitations and Local Sign-In

## Purpose

The Hub now offers two distinct, secure entry mechanisms. **Local email-and-password sign-in** is the normal route for staff and is backed by a MySQL credential store. **Guest invitations** are deliberately narrower: a company administrator can create a time-limited, revocable link for a single property’s basic summary. A guest invitation does not create a Hub user account, entity membership, operational role or reusable session.

| Mechanism | Who can use it | What it allows | What it never allows |
|---|---|---|---|
| Local email-and-password sign-in | Approved staff with a company-issued local credential | Normal server-authorised role, company, property and placement access | Plaintext passwords, self-service role changes, or bypass of tenant/role checks |
| Guest invitation | Anyone holding a valid, unrevoked invitation | One selected property’s read-only basic summary | Young-person or placement data; safeguarding, health, HR, rota, finance, documents, audit records, admin controls or another company’s information |

## Operating Guest Invitations

Company administrators open **Access control** and choose **Create guest link**. They select one property, optionally add a recipient label, select a 24-hour, 3-day or 7-day expiry, and limit the link to one, three or five opens. The page displays the new link only once; administrators should copy it immediately and send it only through an approved channel.

The Hub stores only a SHA-256 hash of the opaque 32-byte token. The plaintext token is neither persisted nor included in audit metadata. Expiry, revocation, use count and property/entity linkage are checked by the server whenever the link is redeemed. Creation, redemption, revocation and denied redemption attempts are recorded to the restricted, hash-linked audit trail.

Administrators can revoke an active link from the same Access control panel. Revocation takes effect immediately. A guest sees one generic unavailable message for a missing, expired, revoked or exhausted link, so the response does not disclose tenant, property or invitation information.

## Local Sign-In Boundaries

The Hub stores a salted, one-way scrypt password hash and normalised email address in MySQL. It validates credentials server-side, returns generic failure messages, locks repeated failures temporarily and records restricted authentication audit events. Company membership, role, property scope and assignment scope remain separate server-authoritative checks after sign-in.

The initial owner uses a one-time `LOCAL_AUTH_BOOTSTRAP_TOKEN` to set a strong local password. Company administrators issue colleague credentials and time-limited one-time reset links through Access control. The Hub does not yet send reset email automatically; administrators must use an approved secure delivery channel.

## Security Review Checklist

| Control | Verification status |
|---|---|
| Company-admin-only creation, list and revocation | Enforced through the canonical `config.write` capability check |
| Tenant and property scope validation | Property must belong to the selected entity before invitation creation |
| Opaque, non-plaintext token persistence | Stored as a one-way SHA-256 hash only |
| Expiry, revocation and bounded-use enforcement | Server-side, including an atomic conditional use-count update |
| Sensitive-domain exclusion | Guest endpoint returns only an allowlisted property summary payload |
| Audit evidence without token disclosure | Restricted create, redeem, revoke and denial events are recorded |
| Local sign-in integrity | Salted one-way password hashes, generic login errors, session-version revocation and one-time bootstrap token controls |

## Support Handling

If a recipient cannot open a link, issue a new one rather than attempting to diagnose whether it was valid. If a company needs a broader external-sharing use case, complete a data-sharing assessment and build a separately scoped, role-reviewed workflow. Do not reuse guest invitations for care records, invoices, HR evidence, safeguarding information or the document library.
