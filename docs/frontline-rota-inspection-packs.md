# Frontline Rota, Replacement Cover and Inspection Packs

## Scope and TEST-data boundary

The Supported Accommodation Hub remains a **fictional TEST platform**. This release improves the operational presentation and record controls for rota activity, but it does not represent a real service record or replace managerial, safeguarding, employment or regulatory judgement.

## Frontline Keyworker rota

A Keyworker opening **Rota & shifts** receives the compact **My shift** view instead of the management dashboard. The view contains only shifts allocated to that user and presents an entire 06:00–06:00 operational day on one compact mobile timeline. Each shift card identifies the premises, full start and finish time, and whether the shift is current. The card also provides a controlled contact action.

The contact action returns only the colleagues whose shifts overlap the selected shift at the same premises and the recorded property manager or supervisor. Phone and email links are shown only when operational details are recorded. The server enforces both current-shift property scope and the requirement that a Support Worker can request contacts only for their own shift. Every lookup is audited without storing contact values in audit metadata.

## Manager and RSM coverage action

Management users retain the **Premises** and **Shift Workers** coverage perspectives. Each identified interval gap has a **Find replacement** action. The workflow checks the proposed Keyworker against active entity membership, property assignment, overlapping shifts, blocks, working-time rules and any required training or qualification. A blocked worker cannot be selected.

Where a worker is otherwise available but has a non-blocking scheduling warning, the manager must enter a specific override reason before allocation. The replacement shift holds the gap key and slot used to create it, preventing duplicate direct allocations for the same staffing slot. The platform records the allocation and override evidence in the audit chain and immediately re-evaluates that property’s day-level coverage. Any related gap notification remains open until the interval is actually covered, then is resolved by the existing coverage-monitoring logic.

Shift creation continues to use the existing server-side validations. Created and replacement shifts are stored as governed shift records and remain available to the existing printable shift-register and timesheet export workflows.

## Controlled inspection pack

Owners, RSMs/Managers and the Nominated Individual can open **Quality of support reviews** and select **Inspection pack**. A pack can cover all authorised premises or a single authorised premises. The generated ZIP contains the following controlled materials:

| Item | Inclusion rule |
|---|---|
| `inspection-pack-index.pdf` | Always included; lists scope, approved quality reviews, file provenance and hashes without repeating protected narratives. |
| `inspection-pack-manifest.json` | Always included; records a minimal versioned inventory and source hashes. |
| Quality-review PDF | Included only for approved or submitted quality reviews with the approved report PDF. |
| Quality-review evidence files | Includes all non-quarantined uploaded versions linked to reviewed evidence for included quality reviews. |
| Released printable record PDFs | Included for Owners and RSMs/Managers where they are ready, archived printable exports in the selected scope. Nominated Individual packs omit these operational report files. |

A pack fails safely rather than silently omitting a required approved report source. The ZIP is stored in object storage; MySQL retains document metadata, version, hash, retention information and the export job only. It is not displayed in the generic document library and can be downloaded only through the restricted inspection-pack workflow. Creation and download are audited using metadata-only events.

## Quality review evidence capture

The Quality of Support Review evidence action supports selecting an existing governed document or attaching multiple photographs, scans, PDFs and Word files directly from a phone. Each file is validated, stored in object storage, individually hashed and retained as a restricted controlled document version. The workflow continues to require the user to check report content in the draft PDF before independent approval.
