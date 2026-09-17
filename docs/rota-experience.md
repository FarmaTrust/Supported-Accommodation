# Role-Aware Rota Experience

## Purpose

The redesigned **Rota & shifts** workspace provides a compact, coverage-first operational view for the fictional TEST platform. It uses one server-authorised shift set for coverage totals, timeline rows, colleague groups, property summaries and management scheduling. The interface is designed for phone use first while retaining a weekly planning board for RSM and Owner desktop reviews.

The operational day is shown as **06:00 to 06:00 the following day**. Shift times are persisted in UTC and displayed in the user's device locale. Each selected-day timeline shows the fixed marks 06:00, 10:00, 14:00, 18:00, 22:00, 02:00 and 06:00, and displays a live marker when the current time falls within the selected operational day.

## Role presentation

| Role | Rota information | Permitted action |
| --- | --- | --- |
| Platform administrator, Owner and RSM | Selected-day coverage, gaps, timeline, colleagues, property summary, approvals, timesheets, handovers and schedule board | Create and reschedule authorised shifts, approve requests, complete related controls and request controlled PDFs |
| HR/Compliance | Selected-day coverage, timeline, colleague groups and authorised timesheets | Review authorised records and request controlled PDFs; no schedule or request-approval controls |
| Read-only colleague | Selected-day coverage, timeline and colleague groups within their existing scope | View only |
| Key Worker | A compact **My current and next shifts** panel inside Keyworker App | View only their own assigned current/upcoming shifts; clock actions and staff requests remain within their existing scoped workflows |

Key Workers are not given a general Rota & shifts navigation route. The server continues to restrict their shift response to the logged-in worker's own assigned shifts. This is not a client-side privacy convention: the same restriction applies to the new selected-day overview procedure.

## Coverage and data-quality indicators

Coverage is surfaced before the timeline with four clear controls: scheduled, covered, needs review and coverage gaps. A red priority panel lists the first uncovered shifts and takes an operational manager directly to the Schedule view. The selected **Premise** and **Colleague** dropdowns apply across coverage and colleague views, and a prominent clear-filter action restores the full authorised set.

The **Data checked** state is calculated from the same returned shift set. It identifies invalid time windows and a colleague's overlapping assignments. A green result indicates no such timing or allocation issue was found in the selected rota; it is an application validation aid and does not replace manager supervision, safeguarding judgement or formal staffing review.

## Scheduling controls

The RSM schedule view presents a weekly worker-by-day board. On desktop, a shift can be dragged to a relevant worker/day. On phones, every shift exposes a visible **Move** action that opens a labelled review dialog. Both interaction styles submit the same proposal to the server, which reloads the shift and validates entity membership, property scope, optimistic version, start/end chronology, worker eligibility, overlap, rest period, availability and the active working-time policy before writing atomically.

The staged move dialog uses dropdown-led Property and Key Worker selection, supports an open-shift state, displays plain-English errors, and only enables an override after an appropriately detailed reason has been entered. Existing encrypted audit evidence and manager override requirements are retained.

## Privacy and TEST-data boundary

The rota experience displays only fictional TEST worker labels, test premises and authorised shift metadata. It does not reveal young-person records, safeguarding narrative, precise attendance coordinates or document content. It performs no automatic external notifications or data transmission. Existing Rota, clock, handover, approval and printable-PDF access controls remain authoritative.
