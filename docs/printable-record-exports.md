# Printable Record Exports

## Purpose and TEST-data boundary

The **Printable Record Exports** workflow produces factual, date-range PDF snapshots from the fictional TEST platform. It does not create narrative content, amend source records, or transmit records to external organisations. The output states that it is a fictional TEST platform record and must not be treated as real operational evidence.

The workflow is deliberately separate from browser printing. Browser printing remains a user convenience. A controlled PDF export creates a traceable archive record, calculates an immutable SHA-256 snapshot hash, stores PDF bytes in object storage, records governed document metadata in MySQL, and writes audit evidence for the request, review, release and download.

## Available exports

| Export | Date range | Who may request | Release rule | Content boundary |
| --- | --- | --- | --- | --- |
| Young-person record compilation | Required, up to three years | A user already authorised for the active placement and, for support workers, the current assigned shift | A different Owner, RSM or Manager must independently approve before download | Selected placement only; activity, curfew, professional contacts, medication, health monitoring, Keyworker reports and incidents within the selected period |
| Shift and attendance register | Required, up to three years | Owner, RSM/Manager, or HR/Compliance, within authorised property scope | Prepared as a controlled record after request | Shifts, clock evidence and only authorised handovers; no precise location coordinates |
| Approved timesheet | Timesheet period | Owner, RSM/Manager, HR/Compliance, or the timesheet worker for their own approved sheet | The existing independent timesheet approval must already exist | Clock-derived minutes and exception metadata only |
| Controlled document register | Required, up to three years | Owner, RSM/Manager or HR/Compliance, within authorised property scope | Prepared as a controlled record after request | Document register metadata, classification, version, review and retention details; never bundles source files |

The selectable period includes the full start and end dates in UTC. The server rejects blank, invalid, reversed, zero-length and over-three-year periods. The interface mirrors this rule so that users can correct the dates before submitting.

## Young-person compilation approval lifecycle

A young-person PDF starts as an **awaiting approval** request. The service renders a staged, immutable PDF and archives it as a generated document in `in_review` status. The request row holds scope, lifecycle data, record counts and a snapshot hash. It does not duplicate protected narrative text in its JSON manifest.

An authorised Owner, RSM or Manager uses the **Young-person export approvals** panel in the RSM App to preview the staged PDF. The same user cannot approve their own request. An approval appends an approval certificate to the staged PDF rather than rebuilding the source snapshot. The resulting second document version is marked approved, includes approver name, role and UTC timestamp, and is the only version released through the export workflow. A return or decline requires an encrypted explanatory reason of at least ten characters.

A request that cannot produce a PDF moves to `failed` with the stable code `pdf_generation_failed`. Provider error detail, storage URLs, signed URLs and narrative content are not placed in request metadata or audit records. A Manager, RSM or Owner may re-preview and retry a failed staged request while the original requester remains unable to self-approve.

## Access and audit controls

Every request recalculates authorisation on the server. Young-person requests use canonical placement access and apply the active-shift boundary for support workers. Shift and document-register requests independently verify entity capability, operational role, property grant and accessible-property set. A browser-supplied entity, property, placement or timesheet identifier is never treated as proof of access.

Controlled printable PDFs are excluded from the general Documents library and blocked from its ordinary version and download procedures. They can only be opened through the export workflow, which rechecks the appropriate current authorisation and requires `ready` status. This prevents a generated document ID from becoming a bypass around placement scope or approval state.

Audit events record request, preview, return, decline, approval, generation failure and download. Metadata includes export type, document ID and source record count where relevant. It does not include the protected record narrative, PDF bytes, object key, signed URL, review reason or authentication tokens.

## Operational use

In **Care & health**, select an authorised young person and use **Request approved PDF**. Choose a date range and submit. The requester can monitor the visible state but cannot download a record until it is independently approved.

In **Rota & shifts**, use **Export shift PDF** to choose an authorised property or all authorised properties and a range. In the Timesheets section, the **PDF** action is available only after a timesheet is approved or exported.

In **Documents & evidence**, eligible roles use **Printable register** to produce a controlled index. This record is an index of document metadata; it does not attach or disclose the original certificate, evidence or other files.

## Data retention and recovery

Each generated document has the retention basis **Controlled printable-record export — retain under the entity record-retention schedule** and a seven-year default retention date. Object storage holds the PDF bytes. Relational tables hold only object references, hashes, record metadata and lifecycle data. The ordinary archive governs future retention review; no PDF-byte column has been added to MySQL.

If an export is disputed, preserve the request ID, staged or approved document version, snapshot hash and linked audit events. Do not edit or replace the archived version. Create a fresh request from the corrected source records and process it through the same independent approval flow.
