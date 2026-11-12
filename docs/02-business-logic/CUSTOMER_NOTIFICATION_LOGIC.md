# Customer Notification Logic (Web Push + Service Workers)

## 1. Core Consent & UX Rules

1. **No Auto-Prompt on Page Load**: Customers arriving via QR scan MUST NEVER see a browser permission dialog before creating a token.
2. **Post-Creation Explicit Opt-In**:
   - Only after token creation succeeds and `/salon/{salonSlug}/{branchSlug}/token/{publicId}` renders, show an optional card:
     *"Want live turn alerts even if you close this tab? Enable browser notifications for Token A014."*
   - Clicking **"Enable Notifications"** triggers `Notification.requestPermission()` -> registers `/sw.js` -> calls `pushManager.subscribe()` -> saves token-scoped subscription (`POST /api/public/tokens/{publicId}/push-subscription`).
3. **Graceful Degradation**:
   - If permission is `denied` or browser lacks Web Push (e.g., iOS Safari non-PWA), show a helpful non-blocking note (*iOS tip: Add to Home Screen for push alerts*) while keeping live SSE/polling updates working 100%.

---

## 2. Customer Notification Triggers & Idempotency

| Trigger Event | Condition | Anti-Flap Idempotency Key | Sample Message |
| :--- | :--- | :--- | :--- |
| **`TOKEN_CONFIRMED_PUSH`** | Immediately after customer subscribes on confirmation screen (optional welcome verification) | `token:{tokenId}:SUBSCRIPTION_CONFIRMED` | *"Alerts active for Token A014 at Aura Grooming (Main Branch). Current wait: ~20 mins."* |
| **`CUSTOMER_APPROACHING_3`** | `peopleAhead <= 3` AND `peopleAhead > 1` AND token `status == 'WAITING'` (configurable threshold) | `token:{tokenId}:APPROACHING_3` | *"Almost your turn! Token A014 has ~3 customers ahead at Main Branch."* |
| **`CUSTOMER_APPROACHING_1`** | `peopleAhead == 1` AND token `status == 'WAITING'` (or estimated wait `<= 5 mins`) | `token:{tokenId}:APPROACHING_1` | *"Your turn is approaching! Your token: A014. Estimated wait: ~5 minutes. Please stay near the salon."* |
| **`TOKEN_CALLED`** | Token transitions `WAITING -> CALLED` | `token:{tokenId}:CALLED` | *"Your token A014 has been called. Please proceed to the service area."* |
| **`QUEUE_DELAYED`** | Branch paused or wait time increases by `>= 15 mins` (if enabled in `SalonSettings`) | `token:{tokenId}:DELAYED:{bucketHour}` | *"Queue update for A014: Estimated wait is now ~35 mins due to high demand."* |

### Why Queue Fluctuations Never Cause Duplicate Spam
- Suppose `A014` reaches `peopleAhead = 3` -> transaction writes `NotificationEvent` with unique key `token:{id}:APPROACHING_3`.
- If `A014` drops to `peopleAhead = 1` directly (because two ahead cancelled simultaneously), `APPROACHING_1` fires (and `APPROACHING_3` is skipped or suppressed because `APPROACHING_1` supersedes it—specifically: evaluate highest priority applicable milestone!).
- Even if a branch count briefly shifts, `UNIQUE (organizationId, idempotencyKey)` guarantees PostgreSQL inserts each milestone **at most once** per token!

---

## 3. Subscription Scoping & Lifecycle
- Customer `PushSubscription` stores `tokenId` (non-null for customer subscriptions, `userId` null) and `organizationId`, `branchId`.
- Clicking a customer push notification focuses/opens `/salon/{salonSlug}/{branchSlug}/token/{publicId}`.
- When a token reaches terminal status (`COMPLETED`, `CANCELLED`, `NO_SHOW`, `SKIPPED`), no further turn notifications are dispatched, and customer subscriptions are marked `isActive = false` / cleaned up by retention sweep.
- Customer can revoke anytime via an **"Unsubscribe Alerts"** toggle on the token page (`DELETE /api/public/tokens/{publicId}/push-subscription`).

