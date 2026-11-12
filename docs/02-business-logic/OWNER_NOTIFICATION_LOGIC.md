# Owner & Staff Push Notification Logic (Web Push)

## 1. Multi-Device Onboarding Flow

1. Authenticated Owner or Staff member visits `/owner/settings/notifications`.
2. Selects notification preferences (event toggles + branch filter matching their allowed branches).
3. Clicks **"Enable Push Notifications on This Device"** -> browser prompts permission -> registers `/sw.js` -> creates VAPID `PushSubscription`.
4. `POST /api/owner/push-subscriptions` persists `{ userId, organizationId, branchId? (nullable = all authorized branches), endpoint, p256dh, auth, deviceLabel, userAgent }`.
5. Immediately triggers a **Test Push Notification** (*"SalonFlow alerts are now active on this Chrome device!"*) so the owner verifies delivery end-to-end.
6. Supports multiple concurrent devices per user (salon counter iPad + owner's Android phone + home laptop).

---

## 2. Owner & Staff Event Triggers

| Event Type | Recipients | Sample Push Payload | Click Destination |
| :--- | :--- | :--- | :--- |
| **`NEW_TOKEN_CREATED`** | Active owner + staff assigned to that `branchId` with `NEW_TOKEN` preference enabled | **Title**: `NEW CUSTOMER IN QUEUE`<br>**Body**: `Token: A014 \| Rahul Sharma (9876543210) \| Services: Haircut, Beard Trim \| Branch: Main Branch` | `/owner/queue?branchId={branchId}` |
| **`CUSTOMER_APPROACHING`** | Optional staff alert when next-up customer's push threshold triggers | *"A014 (Rahul Sharma) is approaching turn at Main Branch"* | `/owner/queue?branchId={branchId}` |
| **`CUSTOMER_CALLED`** | Optional cross-device sync alert when another staff called a token | *"A014 called at Main Branch"* | `/owner/queue?branchId={branchId}` |
| **`QUEUE_LONG_THRESHOLD`** | Owner/Manager when `waitingCount >= settings.longQueueAlertThreshold` (e.g. `10`) | *"Queue Alert: 10 customers waiting at Main Branch (~75m wait)"* | `/owner/queue?branchId={branchId}` |
| **`NOTIFICATION_DELIVERY_FAILURE`** | Owner/Manager if dead-letter failure count spikes (`>= 3` failures in 10 mins) | *"Warning: Some push alerts failed delivery. View logs."* | `/owner/settings/notifications` |

---

## 3. Multi-Tenant & Branch Scoping Rules
- Staff members assigned ONLY to `Branch B` NEVER receive push alerts for `Branch A`.
- Revoking a staff member (`OrganizationMember.status = 'REVOKED'`) or removing branch access immediately deactivates their `PushSubscription`s for that tenant/branch inside the same transaction!
- Push provider `404 Not Found` or `410 Gone` responses automatically mark the stale `PushSubscription` `isActive = false` (`revokedReason = 'PROVIDER_EXPIRED'`).

