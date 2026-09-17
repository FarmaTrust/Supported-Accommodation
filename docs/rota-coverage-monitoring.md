# Rota Coverage Monitoring

## Purpose

The fictional **TEST — Training Provider** rota demonstrates the production coverage-control pattern without representing real operational data. Coverage is evaluated against each active property’s configured `minimumStaffing` requirement across a **06:00–06:00 UTC operational day**. The calculation uses actual assigned staffing intervals rather than counting open shift records. It therefore detects an unstaffed period even where a manager has not first created an “open shift” row.

## Detection and notification behaviour

The Rota & shifts page provides an Owner/RSM-only **Check 31-day cover** action. It evaluates the selected property scope for up to 31 consecutive operational days and presents each exact interval where allocated staffing falls below the property requirement. The summary reports the number of gaps and the total missing staffing minutes. The selected-day view uses clear red priority cards with property, start/end time and deficit, while retaining the underlying authorised shift timeline for context.

Each detected interval is routed only to active Owners and Registered Managers with all-property access or a current manager assignment at that property. The notification contains only property and rota timing metadata. It never includes young-person, care, visitor, staff-health or safeguarding narrative. The route has a stable per-recipient dedupe key, so repeat evaluations refresh the same urgent alert. When the exact gap is covered, the next evaluation resolves that alert automatically. The existing in-app notification list, unread count and optional browser notification ping provide the delivery surface.

> A `coverageState` on an individual shift remains useful for showing an unallocated or at-risk shift. It is not the authoritative measure of whether an entire property is staffed continuously. The interval calculation is authoritative for property coverage.

## Scheduled checks

The existing managed daily operational evaluator now includes rota coverage for its next 31 operational days. No in-process timer or background worker was added. An Owner or Registered Manager can enable the existing managed daily checks from **Search, notifications & automation**; the scheduler evaluates gaps idempotently and retains unresolved notifications until staffing is corrected.

## TEST coverage fixture

The idempotent fictional loader now supplies six TEST properties, 18 fictional Key Workers and three eight-hour shifts per property per operational day for 31 days: 06:00–14:00, 14:00–22:00 and 22:00–06:00. Each property has three property-assigned fictional workers and the deterministic rotation prevents a worker receiving overlapping assignments. The verification script checks the 31-day count, unique assignments, same-worker overlap, continuous interval coverage and tenant cleanup. The skill dataset validator is also run against a generated JSON export before release.

## Operational guardrails

Coverage checks are server-authorised. Support Workers remain unable to view the broader rota or property-wide staffing gaps; their Keyworker App continues to show only their current and upcoming assigned shifts. Owner/RSM coverage evaluation applies tenant and property scope before querying shift data. The query and alerts are audit-logged with aggregate counts only, and the generated PDF/export controls remain unrelated to this workflow.
