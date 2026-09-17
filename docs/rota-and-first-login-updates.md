# Rota and First-Login Updates

## Role-aware rota views

The **Rota & shifts** screen now presents a compact 06:00–06:00 operational timeline with the full day visible using concise time markers. Managers, RSMs, Owners and the TEST platform administrator can switch the coverage lanes between **Premises** and **Shift Workers**. Premise lanes identify which worker covers each property interval; Shift Worker lanes identify the properties and times allocated to each colleague. The existing server-authorised coverage-gap calculation, 31-day check, overlap prevention and scheduling controls remain authoritative.

Support Workers receive a distinct **My shift** screen when opening the rota route. It displays only their own allocated shifts, the property and the relevant time block. It intentionally excludes coverage gaps, colleague data, open shifts, scheduling, approvals and timesheets. Attendance, handover and required-record actions remain in the Keyworker App.

## First-login phone capture

After a successful sign-in and any mandatory password change, a user without a recorded phone number receives a mobile-friendly prompt to provide one. The prompt can be deferred for the current session. The number is validated server-side, stored as restricted account information, and is not included in client authentication status, local browser profile storage or audit metadata. The audit event records only the action and number length.

This first-login contact prompt does not weaken existing local email/password sign-in, forced-password-change, lockout, session-version or role controls.
