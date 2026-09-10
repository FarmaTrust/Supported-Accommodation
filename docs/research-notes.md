# Regulatory and Operational Research Notes

## Verified primary framework

The platform scope is governed principally by **The Supported Accommodation (England) Regulations 2023** and the Department for Education’s accompanying guide. The Regulations organise duties around four quality standards—leadership and management, protection, accommodation, and support—and separately require a statement of purpose, workforce plan, suitable staffing, protection policies, children’s case records, other operational records, secure record storage, serious-event notifications, admission/discharge notifications, complaints handling, quality-of-support reviews, and evidence of financial viability.[1]

The primary legislation’s table of contents confirms that the product needs first-class structures for the following regulated artefacts rather than relying on unstructured document uploads alone:

| Regulatory area | Product structure required |
| --- | --- |
| Leadership and management | Entity/service profile, responsible persons, statement of purpose, workforce plan, quality evidence, oversight actions |
| Protection | Safeguarding policy, missing-child policy, behaviour-management policy and records, incident triage, external notification workflow |
| Accommodation | Property register, location assessment, premises safety evidence, insurance, room security, maintenance and hazard actions |
| Support | Referral/matching evidence, placement and support plans, progress/review records, young-person voice and professional contacts |
| Staffing | Safer-recruitment checklist, Schedule 1 evidence, DBS/RTW/references/qualifications, induction, supervision, appraisal and temporary-staff controls |
| Records | Structured case records, service registers, document versioning, restricted access, export, retention and secure storage |
| Notifications and complaints | Regulation 27/28/29 triage, deadlines, status, recipient, submission evidence, follow-up updates, complaint investigation and outcome |
| Monitoring | Regulation 32 review schedule, report preparation, recommendations, actions, consultation evidence and six-month cadence |

## Current Ofsted inspection framework

The current Ofsted SCCIF page is marked **updated 1 April 2026**. It states that inspectors review Regulation 27 notifications and reports, consider both their content and quality, and examine how effectively the provider applies learning from incidents. Incomplete notifications can trigger requests for more information, emerging concerns can alter inspection scheduling or become lines of enquiry, and inspectors follow up failures to report outcomes promptly.[2]

This means incident management must not stop at “record and submit.” The workflow should capture immediate protective actions, agencies contacted, manager review, submission evidence, subsequent updates, outcome, learning, associated work-plan actions, and closure approval. Dashboards should show patterns and overdue follow-up as management evidence.

The inspection framework also points to Annex A/A1 data, online questionnaires, notifications, safeguarding concerns, complaints, Prevent duties, FGM reporting, and controlled-drug concerns. The platform should therefore retain extensible event categories, configurable inspection exports, young-person feedback evidence, and permission-aware multi-agency communication logs.

## Data protection, vulnerable users, and DPIAs

ICO guidance states that a DPIA is mandatory where processing is likely to create a high risk to individuals’ rights and freedoms. It lists large-scale special-category or criminal-offence processing and certain systematic evaluations as automatic triggers, and identifies processing involving vulnerable people, tracking, data matching, innovative technology, invisible processing, and biometric data as high-risk indicators. Children are explicitly treated as vulnerable individuals for this assessment.[3]

The system should therefore include a **privacy-risk register** and a lightweight DPIA pre-screen for new processing activities, integrations, matching/scoring features, geolocation, CCTV/monitoring, biometrics, or new sensitive-data categories. Each assessment should retain purpose, data categories, subjects, lawful basis, Article 9/10 condition where applicable, necessity, risks, mitigations, DPO consultation, residual risk, approval, review date, and linked system features. Changes to high-risk features should create a review task rather than silently inheriting an old assessment.

The ICO’s children’s-information hub directs organisations to guidance covering automated decision-making and profiling, information sharing, children’s data-protection rights, and age-appropriate design. This supports a design where young people can receive concise, accessible privacy explanations, understand why information is recorded or shared, and exercise access or correction rights without exposing other people’s information.[4]

Product controls should include permission-aware subject-access exports, third-party redaction review, correction requests, processing-restriction flags, information-sharing rationale and recipient logs, age-appropriate privacy-notice versions, acknowledgement evidence, and manual human review for any future automated placement or risk recommendation.

## Confirmed and proposed future requirements

The government’s response to the supported-housing regulation consultation was updated on **19 June 2026**. It confirms the policy direction towards National Supported Housing Standards, local-authority licensing, fit-and-proper-person controls, accommodation and use conditions, needs assessments, service-manager suitability, local supported-housing strategies, and a link between licensing and Housing Benefit in England. Detailed guidance and draft regulatory implementation remain part of the next steps, so individual obligations and dates must be treated as configurable rather than assumed complete.[5]

To support this reform without redesign, the platform needs a generalised **regulatory regime** model. An entity, service or property should be able to hold multiple registrations, licences and commissioning frameworks at once, each with issuing authority, applicability, conditions, evidence, responsible person, renewal, inspection, enforcement status and reporting requirements. The compliance engine should calculate obligations from regime version plus property/service characteristics instead of embedding a single Ofsted-only checklist.

Ofsted’s consultation published **7 July 2026** proposes a five-point grading scale, a secure-fit grading method, report cards with supporting data, better alignment with the Children’s Social Care National Framework, more consistent engagement with children and families, separate grades for each SCCIF evaluation area, and a new evaluation area on enduring relationships. These are proposals, not yet final requirements.[6]

The internal quality dashboard should therefore store evaluation frameworks as versioned configuration. It should be able to map evidence, outcomes, actions and young-person feedback to several evaluation areas simultaneously; retain snapshots used in past self-assessments; and support future five-level scoring without replacing today’s three-outcome inspection history. Relationship continuity, young-person voice, multi-agency collaboration, placement stability and improvement evidence should be measurable dimensions rather than free-text afterthoughts.

## Workforce checks and evidence minimisation

The Home Office’s employer guide requires Right to Work checks before employment and explains initial checks, follow-up checks, acceptable evidence, online checks, the Employer Checking Service and TUPE scenarios. The publication page was updated on **16 July 2026** and includes a draft employer guide, so the platform must version check rules and not assume that today’s method or scope is permanent.[7]

Right to Work records should capture the check route, check date, identity confirmed, evidence reference, outcome, restrictions, expiry or follow-up date, checker and verification artefact. Status expiry must generate an escalating action before the statutory excuse lapses. Rules should be configurable so broader worker categories proposed for later 2026 can be enabled without changing existing records.

DBS guidance emphasises eligibility for the requested check level, identity validation, the code of practice, applicant rights and secure handling. It also states that information revealed on a certificate should normally be destroyed after a suitable period, usually no longer than six months. The operational system should therefore retain the **minimum compliance metadata**—check level, workforce/role eligibility rationale, certificate number, issue date, result/risk-decision status, Update Service consent/status where used, decision-maker and review date—while storing certificate imagery only when a documented policy permits it and placing it in a short-retention, access-restricted evidence class.[8]

The staff assignment engine should prevent or prominently warn against rota allocation when mandatory pre-employment steps, DBS eligibility evidence, Right to Work status, role-critical training or risk-approved exceptions are incomplete. Overrides should require permission, a reason, expiry and manager review.

## Invoicing and finance records

HMRC’s VAT record-keeping guidance requires VAT records to be complete, current and capable of supporting the VAT calculation. It requires copies of issued invoices and relevant business records to be retained, generally for at least six years. A full VAT invoice must use a sequential number from one or more series that uniquely identifies it, and include the supply time, issue date where different, supplier identity/address/VAT number, customer identity/address, sufficient description, quantity or extent of services, VAT rate, net amounts, total net amount, VAT amount in sterling and unit price.[9]

The invoicing design must therefore separate **draft identity** from **issued identity**. A number should be reserved and committed atomically only when an invoice is issued, while voids, corrections and credit notes retain an unbroken audit explanation. Issued invoices should be immutable accounting snapshots; corrections should use credit/reissue workflows rather than overwriting historic amounts or customer details.

Each invoice should store entity, local authority, placement and young-person reference, purchase-order number, contract/fee-schedule version, service-period start and end, issue and supply dates, payment terms, currency, VAT basis and line-level rate, totals, bank-detail snapshot, delivery history, payment allocations, dispute state and reminder history. The requested 28-day fee period can be generated by default but should remain visibly reviewable because placement starts, ends, suspensions and contract variations can create pro-rata exceptions.

Finance access should be separated from care-detail access: users creating or chasing invoices need the minimum placement reference, authority, fee and occupancy dates, not unrestricted case notes. Bank changes and manual invoice-number overrides should require elevated permission, reason, secondary approval and an audit event.

## Accessibility and authentication

GOV.UK’s WCAG 2.2 overview identifies Level AA as the target for government services and highlights requirements directly relevant to this platform: content must work at 200% text size and reflow to a single column at 400%; all functions must be keyboard operable; focus must remain visible; alternatives must exist for drag or swipe interactions; targets must be sufficiently large or spaced; fields need visible meaningful labels; errors must be easy to identify and correct; repeated information should be easy to re-enter; authentication should not depend on memory or puzzles; and status messages and dialogs must expose their purpose and state to assistive technology.[10]

These requirements become testable product criteria: no colour-only RAG meaning, persistent labels rather than placeholder-only fields, error summaries linked to fields, minimum touch targets, logical focus restoration after dialogs, skip navigation, table alternatives on small screens, keyboard-complete rota actions, accessible live regions for save/job status, reduced-motion handling, 200%/400% zoom testing and pre-population that does not conceal where values came from.

NCSC guidance recommends strong MFA for corporate online services, with particular attention to sensitive-data access, trusted-device signals, anti-pattern avoidance and selecting services that support the required authentication strength. Its 2026 material also promotes passkeys as a more secure and usable default than passwords.[11]

Authentication should remain federated and SSO-ready, while the application adds policy metadata for MFA assurance, recent-authentication time, session/device information and step-up requirements. High-risk actions—revealing bank details, changing permissions, exporting safeguarding/HR data, creating secure links, issuing invoices and overriding compliance blocks—should require a sufficiently recent strong-authentication event when the identity provider can expose it. Break-glass access should be time-limited, reasoned, alerted and independently reviewed.

## Exact statutory workflow and retention rules

Regulation 27 requires written notification **without delay** for specified serious events. The event types include a child’s death, a referral of a worker under section 35 of the Safeguarding Vulnerable Groups Act, suspected or actual sexual or criminal exploitation, a serious police-involvement incident, an abuse allegation against the undertaking or a worker, the start and conclusion of a child-protection enquiry, restraint, and any other child-related incident the registered person considers serious. Notifications must identify the event, other people or organisations notified, and actions taken. Recipient rules vary by event and can include Ofsted, the accommodating authority, host local authority, Secretary of State, integrated care board and other relevant persons.[12]

The incident workflow therefore needs rule-based recipients rather than a single “send to Ofsted” toggle. It should show an explicit **without-delay clock**, allow an initial incomplete-but-safe notification followed by updates, require manager confirmation of notifiability, and preserve submission evidence and the eventual outcome. The system must not claim that every Regulation 27 event has a universal 24-hour statutory limit; “without delay” is the primary legal wording.

Regulation 28 requires written notification without delay to the host local authority for every admission or discharge unless it is also the accommodating authority. The notification includes the child’s name and date of birth, statutory placement basis, care/supervision/interim-care order status, accommodating-authority and IRO/personal-adviser contacts, and EHC-plan or statement information.[13] Placement commencement and closure should therefore create a recipient-aware notification task pre-populated from structured records, with an explicit “same authority” exemption decision.

Regulation 32 requires a quality-of-support review at least every six months, considering children’s views, feedback and complaints; the effect of the accommodation on preparation for transition in and out; feedback from accommodating authorities, staff and relevant people; and relevant research and developments. The written report must state intended actions, be sent to Ofsted within 28 days of completion, and be available to accommodating authorities on request.[14] The quality-review module should lock the evidence period, track consultation coverage, generate an action plan, start a 28-day submission clock, and link resulting actions to the operational work-plan register.

Regulation 24 requires each child’s case record to contain Schedule 2 information, remain current, and have each entry signed and dated. If a child dies before 18, the record is retained for 15 years from death; otherwise it is retained for 75 years from date of birth. Records must be secure, and if the undertaking ceases operating, case records must transfer to the accommodating authority.[15] This rules out a generic short retention policy and requires author identity, immutable entry history, transfer/export manifests and long-term preservation metadata.

Regulation 25 allows the Schedule 3 service records to be electronic, requires them to remain current and accessible to children, Ofsted and accommodating authorities, and sets a minimum retention of 15 years from the last entry.[16] Access here still needs identity verification, least disclosure and export logging; “accessible” does not mean publicly available.

## Architecture consequences identified so far

Access control must be enforced on the server for **entity, property, role, assigned young person, data classification, action type, and record state**. Every allowed or denied access to young-person, safeguarding, HR, bank, export, or secure-link data should create an append-only activity event. Generated exports need manifests and redaction controls so the same source records can safely support management review, local-authority sharing, Ofsted inspection, and data-subject requests.

Regulated schedules should be data-driven rather than hard-coded. The compliance engine must support configurable requirement types, applicability rules, statutory or policy basis, owner role, evidence type, lead times, escalation routes, recurrence, grace handling, completion approval, and versioned rule changes. This will allow future inspection and supported-housing licensing rules to be added without redesigning the database.

## References

[1]: https://www.legislation.gov.uk/uksi/2023/416/contents/made "The Supported Accommodation (England) Regulations 2023"
[2]: https://www.gov.uk/government/publications/social-care-common-inspection-framework-sccif-supported-accommodation/social-care-common-inspection-framework-sccif-supported-accommodation-for-looked-after-children-and-care-leavers-aged-16-and-17 "Social care common inspection framework (SCCIF): supported accommodation"
[3]: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/data-protection-impact-assessments-dpias/when-do-we-need-to-do-a-dpia/ "When do we need to do a DPIA?"
[4]: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/ "Children's information"
[5]: https://www.gov.uk/government/consultations/supported-housing-regulation-consultation/outcome/supported-housing-regulation-consultation-government-response "Supported Housing regulation: consultation – government response"
[6]: https://www.gov.uk/government/consultations/improving-the-way-ofsted-inspects-childrens-social-care/improving-the-way-ofsted-inspects-childrens-social-care-consultation-document "Improving the way Ofsted inspects children’s social care: consultation document"
[7]: https://www.gov.uk/government/publications/right-to-work-checks-employers-guide "Right to work checks: an employer's guide"
[8]: https://www.gov.uk/guidance/dbs-check-requests-guidance-for-employers "DBS checks guidance for employers, voluntary organisations and third parties"
[9]: https://www.gov.uk/guidance/record-keeping-for-vat-notice-70021 "Record keeping (VAT Notice 700/21)"
[10]: https://www.gov.uk/service-manual/helping-people-to-use-your-service/understanding-wcag "Understanding WCAG 2.2"
[11]: https://www.ncsc.gov.uk/collection/mfa-for-your-corporate-online-services "Multi-factor authentication for your corporate online services"
[12]: https://www.legislation.gov.uk/uksi/2023/416/regulation/27/made "Regulation 27 — Notification of a serious event"
[13]: https://www.legislation.gov.uk/uksi/2023/416/regulation/28/made "Regulation 28 — Notification with respect to children admitted into, or discharged from, supported accommodation"
[14]: https://www.legislation.gov.uk/uksi/2023/416/regulation/32/made "Regulation 32 — Quality of support review"
[15]: https://www.legislation.gov.uk/uksi/2023/416/regulation/24/made "Regulation 24 — Children’s case records"
[16]: https://www.legislation.gov.uk/uksi/2023/416/regulation/25/made "Regulation 25 — Other records"
