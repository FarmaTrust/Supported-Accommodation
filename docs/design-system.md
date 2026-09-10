# Supported Accommodation Hub — Interface System

## Design intent

The interface uses a restrained Scandinavian vocabulary: cool-grey canvas, warm white surfaces, generous space, assertive near-black headings, thin supporting copy and a small set of bold operational colours. Pale blue and blush geometry provides identity without competing with safeguarding or compliance information.

| Token | Use | Value |
| --- | --- | --- |
| Canvas | Application background | Cool grey `oklch(0.968 0.006 248)` |
| Ink | Headings and primary text | Near black `oklch(0.185 0.010 255)` |
| Action blue | Primary actions and focus | Saturated Nordic blue `oklch(0.565 0.190 252)` |
| Pastel blue | Informational panels and geometry | `oklch(0.900 0.052 244)` |
| Blush | Secondary geometry and gentle emphasis | `oklch(0.915 0.050 18)` |
| Green | Complete / compliant | `oklch(0.660 0.140 151)` |
| Amber | Due soon / attention | `oklch(0.760 0.145 78)` |
| Red | Overdue / critical | `oklch(0.590 0.205 27)` |

The typography is **Manrope**, using weight 700–800 for concise headings, 500–600 for control labels and 400 for supporting text. Interface copy uses plain language and explains consequences before sensitive actions.

## Interaction rules

Primary actions are limited to one visually dominant action per surface. Secondary actions use subtle outlines or tinted surfaces. Complex records open in sheets or dedicated pages, while creation forms reveal only the next relevant fields. Inputs have persistent labels, help text where legal or operational meaning could be misunderstood, and minimum 44-pixel mobile targets.

Empty states explain why the record matters and offer the correct next action. Status is always conveyed through text and icon in addition to colour. Sensitive values are masked by default, and high-risk exports, bank details, permission changes and issue actions require explicit confirmation.

Mobile navigation uses a drawer and persistent context header. The Key Worker route prioritises one-handed reporting, large choices, draft preservation and a clear submit state. Tables become stacked cards below tablet widths rather than forcing horizontal reading.

## Accessibility baseline

All interactive elements remain keyboard reachable with visible focus. Text and controls target WCAG 2.2 AA contrast. Dialogs have programmatic titles and descriptions, validation identifies the field and corrective action, and motion is reduced when requested by the operating system. Search, selectors and status filters have explicit accessible names.

