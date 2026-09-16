# Multi-Company Readiness Upgrade — Implementation and Verification Record

**Status:** Ready for controlled testing. **Author:** Manus AI. **Scope:** structured operational handover, review evidence, manager approvals, local credential lifecycle, fictional role accounts and Keyworker navigation consolidation.

## Delivered changes

1. **Optional structured shift briefs.** The Keyworker App now captures optional template-led handover content alongside existing shift notes. It supports structured nursing-shift prompts without replacing the authoritative handover record. The server continues to apply entity, property and placement scope before returning or writing the brief.

2. **Visible dictated-text review evidence.** Handover records can show whether dictated text is pending review, reviewed or approved. Reviewer identity and review time are appended as evidence, and dictated content remains protected by the existing encrypted operational-record path.

3. **Manager report decisions.** The Manager App contains direct actions to approve a submitted report or return it for correction. A return decision requires a reason. Each decision is routed through the existing server-authoritative manager workflow and produces restricted audit evidence.

4. **Forced first-login password change.** Newly issued local credentials are marked `mustChangePassword`. Server middleware blocks ordinary business procedures for such a session and permits only the self-service password-change path and safe authentication operations. Changing the password increments the credential version, which invalidates earlier local sessions.

5. **Sign-in user experience.** The email/password screen now provides generic incorrect-password feedback, a password-visibility control, a forgot-password entry point, recovery guidance and a forced-password-change screen. Messages do not reveal whether an email account exists.

6. **Password-reset delivery in testing mode.** Reset tokens remain random, hashed at rest, one-time and time limited. Outbound delivery is **deliberately disabled for testing** because no verified email-provider credential has been supplied. The UI and API now state that a company administrator must issue a temporary password; no reset email is falsely claimed as sent. Production activation requires a verified sender, the public HTTPS application URL and a server-only Resend API key.

7. **Fictional TEST account set.** The fictional role accounts exist only in **TEST — Training Provider**, and every credential is stored only as a salted one-way hash. The reusable fixture provisioner requires first-login rotation; the currently issued Manager, Finance and Key Worker test credentials have that gate deliberately cleared so their role boundaries can be exercised immediately. Credentials are intentionally not reproduced in this document.

| Test account | Login email | User role | Active membership / scope | Intended test coverage |
|---|---|---|---|---|
| Superadmin | `test.superadmin@training-provider.example.test` | `admin`, `platform_admin` | Explicit Owner membership in TEST — Training Provider only | Broad TEST workspace access; no global tenant bypass |
| Owner | `test.owner@training-provider.example.test` | `admin`, `owner` | Owner, all TEST properties | Company-owner administration within TEST |
| Manager | `test.manager@training-provider.example.test` | `user`, `registered_manager` | Manager, all TEST properties | Properties, reports, rotas, workforce requests and approvals |
| Keyworker | `test.keyworker@training-provider.example.test` | `user`, `support_worker` | Limited to TEST — Radford House (30 Radford Road) and its three explicit fictional placements | Keyworker App, assigned records and shift workflows; confirms property and placement denials outside this scope |
| Finance | `test.finance@training-provider.example.test` | `user`, `finance` | Finance, all TEST properties, compliance read/write exceptions | Finance and permitted compliance workflows; confirms no young-person or safeguarding access |

> **Important:** The Superadmin test account is intentionally implemented as a `platform_admin` user with an explicit Owner membership in the fictional TEST tenant. It is **not** a global cross-company bypass. Production break-glass administration requires a separate, audited design. The Manager, Finance and Keyworker accounts are fictional, reside in the TEST tenant only, and must be rotated or retired before any production data is introduced.

8. **One Keyworker navigation entry.** The side navigation and mobile navigation now show a single **Keyworker App** entry at `/keyworker-app`. The prior `/key-worker` address remains a compatibility alias to the same unified workspace, so existing saved links do not produce a dead end.

## Verification completed

- TypeScript compilation passed after the final testing-mode reset update.
- The full automated suite passed before the final wording update: **60 test files and 186 tests**.
- Focused reset-email guard and authentication-status tests passed after the final update.
- The production build completed successfully.
- The application was restarted from a clean process; fresh server, browser and network diagnostics showed no new runtime, import or API errors.
- Desktop and phone checks confirmed the email/password form, password visibility control, recovery entry point and responsive layout.

## Production activation checklist

- Verify `raja.sharif@farmatrust.com` as an approved sender in the chosen email provider.
- Add a server-only provider API key and retain the fixed public HTTPS app URL.
- Run a live non-sensitive password-reset delivery test and record its audit result.
- Retire the TEST-only accounts or rotate their passwords before any production data is introduced.
- Add MFA and a formally approved, audited break-glass process before operational go-live.
