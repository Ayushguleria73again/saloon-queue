# Notification & Outbox Test Cases (`NOTIFICATION_TESTS.md`)

Executed with real PostgreSQL transactional outbox + mocked `web-push` HTTP transport boundary.

---

## Test Matrix

- **`NT-01` (Token Validity Independent of Push Failure)**:
  - Configure mocked `web-push` to throw `503 Service Unavailable` / network timeout.
  - Submit customer token -> **Assert**: Token creation returns `201 Created`, token is live on dashboard, and `NotificationEvent` schedules `RETRYING` with exponential backoff (`nextAttemptAt > NOW()`).
- **`NT-02` (Expired Subscription Cleanup — `410 Gone` / `404`)**:
  - Owner has 2 registered devices (`Device 1` returns `201`, `Device 2` returns `410 Gone`).
  - Process outbox event -> **Assert**: `Device 1` delivery marked `ACCEPTED_BY_PROVIDER`; `Device 2` delivery marked `FAILED` AND `Device 2`'s `PushSubscription.isActive` immediately flips to `false` (`revokedReason = 'PROVIDER_EXPIRED'`).
- **`NT-03` (Customer Milestone Idempotency Under Fluctuations)**:
  - Queue has `A001`..`A005`. `A005` has push enabled.
  - `A001` completes (`A005` now `3 ahead`) -> `CUSTOMER_APPROACHING_3` queued & sent once.
  - Simulate re-evaluation / concurrent status changes at same threshold -> **Assert**: `UNIQUE (organizationId, idempotencyKey)` prevents any second `APPROACHING_3` notification!
  - Advance to `1 ahead` (`CUSTOMER_APPROACHING_1`) and `Call Next` (`TOKEN_CALLED`) -> each fires exactly once.
- **`NT-04` (Dead-Letter Handling After Max Retries)**:
  - Exhaust `5` retry attempts with persistent `500` errors -> **Assert**: `NotificationEvent.status === 'DEAD_LETTER'` and appears in `/api/admin/jobs` & failure dashboard.
- **`NT-05` (Multi-Worker `SKIP LOCKED` Safety)**:
  - Spawn `2` concurrent `OutboxProcessor.runBatch()` loops against `10` pending events -> **Assert**: Every event is claimed and dispatched **exactly once** (zero duplicate push sends).
- **`NT-06` (Staff Revocation Immediate Stop)**:
  - Revoke Staff Member A -> trigger new customer token at Branch 1 -> **Assert**: Staff A's `PushSubscription` receives `0` deliveries.

