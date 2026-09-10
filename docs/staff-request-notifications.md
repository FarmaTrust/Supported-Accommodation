# Staff-request Outcome Notifications

## Purpose and boundary

An in-app notification is created only after an authorised manager completes a staff-request decision. The alert is addressed to the requesting user, links back to their Staff workspace, and deliberately avoids review notes, request details, certificates, sickness information or other sensitive HR content. This feature provides application-state alerts; it does not enable email, SMS or push delivery.

## Desktop acceptance

**Timestamp:** 2026-08-27 22:03 GMT+1  
**Route:** `/search?entity=30001&tab=notifications`  
**Viewport:** 1280 × 800  
**Data boundary:** `TEST — Training Provider` only

The notification bell showed one unread alert. The direct notification link selected the Notifications panel, where the TEST-only **Staff request approved** card displayed a safe outcome message and no HR-sensitive narrative. Snooze and Resolve controls use the existing current-user notification procedures; opening the alert marks it read and uses its `/staff` deep link.

## Phone acceptance

**Timestamp:** 2026-08-27 22:06 GMT+1  
**Route:** `/search?entity=30001&tab=notifications`  
**Viewport:** 390 × 844  
**Data boundary:** `TEST — Training Provider` only

The direct notification view opened correctly at phone width. The one-item unread badge, selected Notifications tab, safe title and outcome message, timestamp, and Snooze and Resolve controls remained readable and reachable. The card does not reveal the fictional request’s detailed note, requested availability, or manager review comment.

## Verification summary

The complete test suite passed with **135 tests across 39 files**. Focused coverage proves that an authorised decision sends the versioned alert only to the requesting user; a notification read or resolve action for another user returns no record and performs no update; and the direct notification-tab selector rejects unknown tab values safely. Static type checking and production build validation also passed.

After the final restart, the TEST-only notification panel and unread indicator loaded successfully. Post-restart server, browser-console, and network logs show no error-level entry or HTTP 4xx/5xx response for the notification route. This in-app implementation intentionally does not dispatch external email, SMS, or push messages.

## Release checkpoint

Checkpoint `846f17ac` records the recipient-scoped staff-request outcome notification feature, direct notification-panel link, current-user read/resolve controls, TEST-only validation fixture, and the completed validation evidence.
