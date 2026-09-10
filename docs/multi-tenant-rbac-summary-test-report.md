# Multi-Tenant Isolation and RBAC Summary Test Report

**Project:** Supported Accommodation Hub  
**Prepared:** 4 September 2026  
**Scope:** Multi-tenant isolation, role-based access control, property and placement scope, access-administration safety, and temporary identity-provider connectivity handling.

## Overall result

The verified automated checks in scope **passed successfully**. The full regression run completed with **49 test files and 159 tests passing**, alongside a clean TypeScript check and production build. Focused security checks completed with **19 tests passing** across tenant boundary, role-policy, access-control contract, public authentication-status and temporary-provider-connectivity suites.

> These results verify the implemented control paths and negative test cases. They do not replace an independent penetration test, live identity-provider resilience exercise, access-review process, or production monitoring.

| Control area | Verified result | Evidence |
|---|---|---|
| Cross-company entity access | **Passed** | An owner account without an active membership in a requested company is denied. |
| Cross-company property access | **Passed** | Property access is denied when the user lacks membership in the owning entity. |
| Default property and placement scope | **Passed** | Property and placement helper policies deny access outside explicitly assigned scope. |
| Company-admin mutation boundary | **Passed** | A caller without company-administration capability is denied before any access mutation or audit write. |
| Role and capability allowlists | **Passed** | Invalid role and capability values are rejected at the API boundary. |
| Last-admin protection | **Passed** | A change that would remove the final active company administrator is rejected. |
| Access-change evidence | **Passed** | Successful access changes write restricted before/after audit metadata. |
| Temporary provider DNS/transport handling | **Passed** | DNS and transient connection errors map to a safe availability outcome rather than exposing raw provider details. |

## Multi-tenant isolation checks

The test suite verifies that role names alone do not grant global company access. A user is authorised only through an **active membership in the requested legal entity**. This prevents an owner account in one company from reading another company's entity or property records merely because it holds an owner role elsewhere.

Property and placement helpers were also tested in deny-by-default conditions. A registered manager restricted to one property does not receive access to another property, and an unassigned user does not gain placement access from unrelated assignment data.

| Test source | Negative cases verified |
|---|---|
| `server/authz.multiTenant.test.ts` | Owner without membership denied; property access denied without entity membership; property and placement helpers remain restrictive. |
| `server/authz.roles.test.ts` | Role/capability evaluation remains constrained by the canonical authorisation policy. |
| `server/routers/accessControl.contract.test.ts` | Non-admin mutation denial and invalid management inputs rejected. |

## RBAC administration checks

The company-admin access-control route permits only the appropriate tenant-scoped authority to manage membership role, property scope and allowed scoped capabilities. The route rejects malformed role/capability values, requires an auditable reason for elevated access decisions, and protects the final active administrator from accidental removal.

Successful changes are recorded as restricted audit events containing a controlled before/after representation. This gives administrators a reviewable audit trail without placing broadly readable personal or sensitive record data in the audit metadata.

## Reported `api.manus.im` host lookup error

The screenshot showed a device-level DNS failure: the device could not translate `api.manus.im` into an IP address at that moment. This is a **temporary network, DNS resolver, captive-portal, firewall, or upstream service-resolution condition**; it is not evidence of a multi-tenant or RBAC failure.

During investigation, the application environment successfully resolved `api.manus.im` and established HTTPS connectivity. The Hub now classifies transient provider DNS and transport errors such as `ENOTFOUND`, `EAI_AGAIN` and timeouts as **`AUTH_SERVICE_UNAVAILABLE`**. The sign-in screen shows a plain-English retry, account-recovery and support-request path instead of raw socket, hostname or provider internals. A local fallback is retained when the user returns from a provider page that could not be reached.

## Remaining production gates

The implementation is ready for the verified application-level controls described above. Before relying on the platform for commercial operations, complete the following operational gates:

| Required gate | Why it remains necessary |
|---|---|
| Independent penetration test | Automated tests cannot exhaustively assess authentication, session, API and tenant-isolation attack paths. |
| Live identity-provider outage exercise | Confirms device, DNS, mobile-network and callback behavior under real failure conditions. |
| MFA/SSO and access-review policy | Ensures identity assurance and periodic removal of no-longer-required access. |
| Centralised error monitoring | Detects repeated provider connectivity errors, failed requests and client exceptions in production. |
| Backup, restore and incident runbook test | Validates recovery objectives and operational response beyond source-code behavior. |

## Verification record

| Validation activity | Result |
|---|---|
| TypeScript check | Passed |
| Focused provider, tenant and RBAC suites | 5 files, 19 tests passed |
| Full regression suite | 49 files, 159 tests passed |
| Production build | Passed |
| Post-restart server, browser and failed-network log review | No errors observed in the final diagnostic window |
| Public service-unavailable sign-in state | Plain-English message, retry action, recovery action and `AUTH_SERVICE_UNAVAILABLE` developer code verified |
