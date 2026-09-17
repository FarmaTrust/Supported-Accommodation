# Supported Accommodation Hub — Commercial Readiness Test Report

**Report date:** 4 September 2026  
**Author:** Manus AI  
**Scope:** Expanded fictional training scenario, tenant isolation, compliance dashboard evidence, regression testing and runtime smoke validation.

## 1. Executive assessment

The Supported Accommodation Hub was tested with an expanded, isolated **TEST — Training Provider** entity containing six fictional properties, eleven fictional Key Workers, eighteen fictional young people, eighty-four rota shifts, property safety records, staff training records and watermarked mock certificate scans. The test run identified one material authorization defect: a user globally labelled `owner` could bypass the requested entity membership check. This route was corrected so every owner is now required to hold an active membership in the entity being requested.

The application passed the completed automated and runtime verification gates described below. The platform is **conditionally ready for commercial pilot use** from an application-control perspective, subject to the production gates in Section 8. This is not a substitute for an independent penetration test, a DPIA, supplier due diligence, operating policies, live disaster-recovery testing or legal/regulatory sign-off.

| Assessment area | Result | Evidence |
| --- | --- | --- |
| Type safety and production build | Pass | `pnpm check` and `pnpm build` completed successfully |
| Automated regression tests | Pass | 42 files and 142 tests passed |
| Multi-tenant entity isolation | Pass after fix | New negative authorization tests reject non-member owner access |
| TEST data isolation | Pass | Zero TEST property, staff or evidence records in entity 1 |
| Compliance renewal workflow | Pass | 31 in-app reminders and 31 inactive outbox rows generated idempotently |
| Mock evidence storage | Pass | 51 approved, clean-scanned, watermarked TEST certificate documents |
| Runtime desktop and phone smoke checks | Pass | Compliance dashboard rendered without post-restart errors |
| External email transmission | Not activated | Provider remains intentionally inactive; no external email was sent |

## 2. Test environment and data boundary

All newly created records are confined to **TEST — Training Provider**. The entity is clearly marked as fictional and every generated certificate PDF includes the watermark **“TEST DATA — NOT VALID FOR USE.”** The source operational entity, `Nightingale Noble`, was checked after the load and contains no TEST-labelled properties, staff, certificate records, scans, renewal alerts or email-outbox items.

| TEST record set | Verified quantity | Purpose |
| --- | ---: | --- |
| Properties | 6 | Cross-property dashboard, allocation and certificate-matrix coverage |
| Key Workers | 11 | Workforce certificate and property-assignment coverage |
| Young people | 18 | Three active placements at each TEST property |
| Rota shifts | 84 | Two weeks of property-authorised Key Worker shifts |
| Property certificate records | 42 | Seven certificate categories across six properties |
| Staff certificate/training records | 11 | Controlled workforce renewal categories |
| Approved clean certificate scans | 51 | Categorised document-library and evidence-link coverage |
| In-app renewal alerts | 31 | Overdue and 90/60/30-day band coverage |
| Inactive email outbox entries | 31 | Delivery-ready, non-transmitting email workflow coverage |

The property safety categories cover HMO licensing, Ofsted registration/renewal, gas, electrical, fire, insurance and other legal/regulatory certificates. Staff records cover DBS, Right to Work and a representative mix of safeguarding, first aid, medication, fire safety, food hygiene, manual handling and other training. Date states deliberately cover overdue, due within 30 days, due within 60 days, due within 90 days, current and missing-evidence/date conditions.

## 3. Multi-tenant security test

The access model uses the entity ID as the first business boundary, followed by property assignment and placement assignment where the record is sensitive. During this test, the direct authorization review found that the global user profile value `owner` could allow access before a matching entity membership was confirmed. This would have been unsafe in a multi-company deployment.

> **Remediated defect:** `assertEntityCapability` now requires a current active membership for every requested entity, including owners. Ownership determines the capabilities available **within** a tenant; it no longer grants a cross-tenant bypass.

The test suite now includes negative cases showing that an owner without membership in company B is denied both entity-level compliance access and a property request for company B. It also covers restrictive property-assignment and placement-assignment helper behaviour.

| Isolation control | Test performed | Result |
| --- | --- | --- |
| Cross-company entity access | Owner account without target membership requested `compliance.read` | Denied |
| Cross-company property access | Same account requested a property in the unjoined entity | Denied before property access |
| In-tenant owner access | Owner with active entity membership requested compliance access | Allowed |
| Property-limited scope | Non-owner with one property grant requested a different property | Denied by scope helper |
| Placement assignment | Worker without an active placement assignment requested that placement | Denied by assignment helper |
| TEST data leakage | Direct database count against operational entity | 0 TEST records |

## 4. Compliance dashboard and reminder tests

The expanded scenario was loaded twice. The record counts did not grow between runs, proving that the loader reuses natural keys and replaces scenario-owned rota data rather than duplicating it. The dedicated evidence verifier also loaded the certificate dataset twice and confirmed stable counts, clean scan metadata and zero operational leakage.

The actual server-side renewal evaluator was invoked after each evidence load. It generated 31 actionable candidates, 31 idempotent in-app notifications and 31 `draft` email-outbox rows. The email adapter remains deliberately inactive, and the outbox records explain that no provider is connected. No external email was transmitted.

| Renewal condition | Dashboard expectation | Test data coverage |
| --- | --- | --- |
| Overdue | Red urgent alert | Included |
| Due in 30 days | Red urgent alert | Included |
| Due within 60 days | Amber warning | Included |
| Due within 90 days | Amber warning | Included |
| Current | Green | Included |
| Missing evidence or renewal date | Grey/action-required | Included |

## 5. Automated and runtime verification

The final automated run completed TypeScript checking, all Vitest suites and a production build successfully. The test suite includes authorization, role, tenancy, placement, compliance, renewal, evidence, calendar, offline, safeguarding, workforce and data-validation coverage.

| Verification gate | Result |
| --- | --- |
| `pnpm check` | Pass |
| `pnpm test` | 108 test files; 333 tests passed |
| `pnpm build` | Pass; client and server production bundles generated |
| `pnpm testdata:verify` | Pass; 6 properties, 18 Key Workers, 18 young people and 558 shifts across 31 days; zero coverage gaps, duplicate assignments, worker overlaps, property overlaps and source leakage |
| `pnpm testdata:compliance:verify -- 1` | Pass; 42 property records, 11 staff records, 51 clean scans, 31 notifications, no source leakage |
| Desktop smoke test | Pass; dashboard route loaded and rendered |
| Phone smoke test | Pass; dashboard cards, controls and tabs remained usable at 375 × 812 |
| Post-restart logs | Pass; no server errors, browser errors or failed network requests detected |

The visual smoke session was intentionally scoped to the operational entity. It therefore showed no TEST certificate data, which is the expected result of tenant isolation. To inspect the loaded mock dashboard data, select **TEST — Training Provider** from the workspace selector while signed in as the owner account seeded into that entity.

## 6. Defects identified and corrected

| ID | Severity | Finding | Resolution | Regression evidence |
| --- | --- | --- | --- | --- |
| MT-001 | High | A globally labelled owner could bypass target tenant membership in `assertEntityCapability` | Removed the bypass; active membership is mandatory for every entity request | `authz.multiTenant.test.ts` |
| TD-001 | Medium | Expanded TEST loader discarded young-person property assignment while normalising dates | Retained `propertyIndex` in normalised records | Two-pass expanded scenario verifier |
| TD-002 | Medium | Mock evidence insert duplicated type bindings on new rows | Corrected insert values to share the update payload safely | Two-pass evidence verifier |
| TD-003 | Low | Renewal evaluator helper did not terminate because of the server pool | Added deterministic completion for the TEST-only evaluator helper | Two-pass evidence verifier |

## 7. Operational instructions

Use the following commands from the project directory when a tester needs to recreate the scenario. The final numeric parameter identifies the source owner used for safe attribution; it does not place mock data in that source entity.

```bash
pnpm testdata:verify -- 1
pnpm testdata:compliance:verify -- 1
```

The second command generates only TEST-scoped documents, evidence, notifications and inactive outbox records. The PDF files are visibly watermarked and must never be used as real certificates, sent to local authorities or transmitted to suppliers.

## 8. Required production gates before wider commercial rollout

The following work is outside this application-level test run and must be completed before treating the service as production-assured for regulated customer data.

| Gate | Owner | Status |
| --- | --- | --- |
| Independent penetration test covering authenticated API, IDOR and tenant-boundary attack paths | Security supplier | Required |
| Production identity policy: MFA, SSO, invitation lifecycle, leaver controls and privileged-access review | Security / Operations | Required |
| DPIA, data-processing agreements, retention schedule and lawful-basis review | DPO / Legal | Required |
| Backup restore test, RTO/RPO agreement and incident-response exercise | Platform / Operations | Required |
| Email, malware scanning and e-signature provider selection with credential rotation and supplier testing | Product / Platform | Required before activation |
| Load, concurrency and rate-limit testing using representative tenant volumes | Engineering | Required |
| Formal customer acceptance testing using non-production data | Customer / Product | Required |

## 9. Conclusion

The tested application boundary now rejects an owner who is not a member of the requested customer entity. The expanded TEST environment provides realistic but fictional workflow coverage for properties, workforce, placements, rotas, certificate evidence, renewal statuses, in-app alerts and an inactive email-ready outbox. The automated, build and smoke checks passed. The platform should proceed to controlled pilot preparation only after the production gates above are owned, scheduled and evidenced.
