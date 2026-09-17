# Fictional Training Data Guide

## Scenario boundary

`TEST-SA-TRAINING-2026` is fictional, non-production data for interface and workflow testing. The complete scenario is isolated in the separate **TEST — Training Provider** entity. Names, references and `example.test` email addresses must not be treated as real identities, employment evidence, placements or compliance evidence.

| Record type | Loaded scenario |
| --- | --- |
| Properties | Six TEST-labelled properties: TEST — Radford House at 30 Radford Road, TEST — Willow House, TEST — Meadow Lodge, TEST — Ash Grove, TEST — Harbour View and TEST — Cedar Mews |
| Key Workers | Eighteen clearly fictional active support-worker accounts and staff profiles, with three assigned to each TEST property |
| Young people | Eighteen reference-led fictional records, three active placements per property |
| Rota | Five hundred and fifty-eight future eight-hour shifts across 31 operational days. Every TEST property has continuous 06:00–14:00, 14:00–22:00 and 22:00–06:00 cover, with no duplicate or overlapping fictional colleague assignment. |
| Mock compliance evidence | Forty-two property certificate records, eleven staff certificate/training records, fifty-one approved clean scans, thirty-one in-app reminders and thirty-one inactive outbox records; every document is watermarked `TEST DATA — NOT VALID FOR USE` |
| Governance | One `TEST-DR-001` ready information-rights case, one active source-linked training framework, one active training outcome measure and one encrypted test-only observation; every label states that it has no legal or operational effect |
| Staff workspace | One TEST-only workforce profile is linked to the authorised TEST reviewer account so the self-service page can be accepted in its populated state; it is not a real staff record |
| Staff-request notification | One TEST-only approved availability request and a matching unread in-app outcome alert for the TEST reviewer. Neither is a real employment decision, communication or operational record. |

## Load or refresh

From the project directory, run:

```bash
pnpm testdata:load -- 1
```

The final number identifies the source owner used to attribute creation. The loader creates or refreshes the separate TEST entity, uses stable scenario identifiers, reuses matching records and replaces all scenario-owned shifts. It also removes only this scenario’s earlier records from the source entity.

## Fictional finance and authority records

The TEST tenant includes **TEST — Example Borough Council**, **TEST — Northshire County Council** and **TEST — Trent Valley City Council**. All finance and placement contacts use the reserved `.test` domain. The loader distributes the eighteen fictional placements across these authorities, adds `TEST-PO-…` references, creates a fictional four-week fee schedule for each placement and creates one clearly labelled `TST-2026-…` invoice record per placement.

The mix includes sent, part-paid and overdue states so authorised finance users can exercise the statement and archive workflows. These records are never payment demands. From the Finance **Statements** tab, choose an authorised range and select **Save PDF to archive** to create a securely stored, searchable PDF archive item. The browser email action composes a draft only; it never transmits a fictional invoice or statement.

Run the automated repeated-load check with:

```bash
pnpm testdata:verify -- 1
pnpm testdata:compliance:verify -- 1
```

The scenario verifier executes the real loader twice and fails unless the TEST entity remains exactly six properties, eighteen Key Workers, eighteen young people, three active placements per property and 558 shifts. It also fails on missing 24-hour interval cover, duplicate shift assignments, same-worker overlaps or scenario records left in the source entity. The compliance verifier loads the certificate evidence twice and fails unless 42 property records, 11 staff records, 51 approved clean scans and renewal notifications remain TEST-only and stable.

## Safety rules

Do not change fictional accounts into real OAuth identities. Do not issue invoices, send provider packs, transmit notifications or export fictional records to external organisations. Before production acceptance, remove or isolate training records according to the organisation’s approved test-data process and verify that no scenario reference beginning `TEST-` remains in operational reports.
