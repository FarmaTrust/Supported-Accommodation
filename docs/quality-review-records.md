# Quality of Support Review Records

## Purpose and TEST-data boundary

The **Quality of Support Reviews** workspace supports fictional Regulation 32-style review activity in this TEST platform. It is designed to make the report lifecycle understandable: consultation and evidence are recorded first, a user checks and amends a complete draft, an independent accountable reviewer approves the controlled PDF, and submission evidence can then be recorded. The platform does not treat any TEST content as a real operational record.

## Report lifecycle

| Stage | Authorised action | Stored record |
|---|---|---|
| Draft, consultation or evidence review | Authorised Owner, RSM/Registered Manager, Nominated Individual operating through Owner access, or HR/Compliance user records consultation and evidence within their entity/property scope. | Structured review, consultation and evidence records; any uploaded files are stored as controlled document versions in object storage. |
| Report draft | An authorised author completes or revises the report after the required consultation coverage and at least one reviewed evidence item are present. | A new immutable draft PDF is created. If a previous draft exists, its controlled document is retained as **superseded** rather than overwritten. |
| Independent approval | A different Owner, RSM/Registered Manager or Nominated Individual acting through Owner access opens the staged PDF and approves it. Self-approval by either the creator or completer is blocked. | A second PDF version containing an independent approval certificate, named approver role, time and report reference. |
| Submitted | An authorised user records the external submission method and reference after approval. | Submission metadata and audit event; the approved PDF stays available through Quality Reviews. |

## Evidence uploads

The **Evidence** action in a review accepts up to eight images, PDFs or Word documents per bundle. It uses the shared mobile-first file picker, including phone-camera capture and multiple-page review. Each file is checked for type and size, written to object storage, assigned a SHA-256 hash and recorded as a restricted controlled document version. Users may alternatively link an existing authorised controlled document.

Quality-review reports and attached evidence are deliberately excluded from the generic Documents library and cannot be downloaded through generic document endpoints. The relevant Quality Review authorisation is recalculated before report preview or printing. Audit data records identifiers, counts, versions and hashes only; it does not contain review narratives, phone numbers or file contents.

## Inspection and printing

Owners, RSMs/Registered Managers and the Nominated Individual through the Owner-authorised workspace can locate a review from **Quality reviews**, open the staged or final PDF, then print from the browser PDF viewer. The draft carries a prominent pre-approval status. The final PDF includes an independent approval certificate and page numbers.
