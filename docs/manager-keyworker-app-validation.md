# Manager and Key Worker App Validation

## Scope implemented from the attached proposal

The mobile-first Manager App and Key Worker App reuse the existing platform as their single source of truth. The Manager App provides current staffing, coverage warnings, review counts and protected paths into requests, reports, incidents, property actions, rota, compliance and work plans. The Key Worker App provides staff-scoped shift and caseload context, attendance controls, notifications and direct paths into reports, incidents, handover, property, curfew and staff self-service workflows.

## Phone review

**Timestamp:** 2026-08-27 22:20 GMT+1  
**Routes:** `/manager-app?entity=30001` and `/keyworker-app?entity=30001`  
**Viewport:** 390 × 844  
**Data boundary:** `TEST — Training Provider` only

The Manager App loaded a compact command view with touch-friendly notification, rota and exception-queue controls. The live coverage and manager-action cards remained readable, with strong visual distinction for warning and urgent metrics. The Key Worker App displayed only authorised TEST placement references and preferred names, its role-safe empty shift state, alert entry point, and six large task-led actions. The phone shell uses a compact header and bottom navigation with sufficient clearance below the app content.

## Desktop review

**Timestamp:** 2026-08-27 22:20 GMT+1  
**Route:** `/keyworker-app?entity=30001`  
**Viewport:** 1280 × 800  
**Data boundary:** `TEST — Training Provider` only

The Key Worker desktop route displayed the authorised TEST caseload and the same record-action hub without exposing records from another entity. The empty-shift message accurately reflects that the authenticated owner is not assigned to a TEST shift; it does not fabricate attendance context. Manager desktop populated-state verification is recorded separately after the route’s post-load check.

## Completed desktop manager review

**Timestamp:** 2026-08-27 22:22 GMT+1  
**Route:** `/manager-app?entity=30001`  
**Viewport:** 1280 × 800  
**Data boundary:** `TEST — Training Provider` only

The populated Manager App displayed the organisation-specific command view, three active TEST shifts, coverage and review metrics, the protected exception queue, and deep links to the authoritative rota, workforce, compliance, property and quality records. No separate operational store is used by this route.

## Restricted access review

**Timestamp:** 2026-08-27 22:22 GMT+1  
**Route:** `/keyworker-app?entity=99999`  
**Viewport:** 390 × 844

An explicit but unauthorised entity parameter resulted in the dedicated **Key Worker app restricted** state. The screen did not render any property, placement, shift, case, notification or error-internal detail. This confirms that the mobile app does not treat a browser-supplied entity identifier as evidence of access.

## Release checkpoint

Checkpoint `2b42ec21` records the Manager and Key Worker mobile app hubs, the document-to-platform scope map, controlled attendance-exception flow, route and server-boundary tests, invalid-entity audit hardening, and the TEST-only desktop and phone acceptance evidence.
