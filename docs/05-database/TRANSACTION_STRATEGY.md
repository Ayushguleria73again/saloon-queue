# Transaction Strategy & Concurrency Boundaries

## 1. ACID Transaction Map

| Operation | Isolation | Locks Used | Operations Inside Transaction | Executed Post-Commit |
| :--- | :--- | :--- | :--- | :--- |
| **Register Organization** | `ReadCommitted` | Unique index locks (`email`, `org.slug`) | `User`, `Organization`, `StaffRole`s, `RolePermission`s, `OrganizationMember`, `Branch`, `BusinessHours`, `SalonSettings`, `AuditLog` | Session sign-in redirect |
| **Create Token (`QR` / `WALK_IN`)** | `ReadCommitted` | `pg_advisory_xact_lock(branchId:mobile)` + `QueueCounter` `ON CONFLICT DO UPDATE` | Idempotency check, duplicate active token check, `Customer` upsert `(branchId, mobile)`, `QueueCounter` increment, `Token` (`source`) + `TokenService` snapshots, `NotificationEvent` (`NEW_TOKEN_CREATED`), `AuditLog` | `jobRunner.nudge()` + Single-pass branch SSE broadcast |
| **Call Next (Strict FIFO)** | `ReadCommitted` | `SELECT ... FOR UPDATE SKIP LOCKED` on earliest `WAITING` row | Lock earliest `WAITING` token (`sequenceNumber ASC`), transition to `CALLED`, write threshold `NotificationEvent`s (`TOKEN_CALLED`, `APPROACHING_1`, `APPROACHING_3`), `AuditLog` | `jobRunner.nudge()` + Single-pass branch SSE broadcast |
| **Re-queue Skipped Token** | `ReadCommitted` | `FOR UPDATE` on original token + `QueueCounter` `ON CONFLICT DO UPDATE` | Lock `SKIPPED` token (`requeuedToToken` null / not already re-queued), keep original `SKIPPED` row immutable, allocate new `QueueCounter` sequence, insert linked `WAITING` token (`requeuedFromTokenId`), `AuditLog` (`TOKEN_REQUEUED`), `NotificationEvent` | `jobRunner.nudge()` + Single-pass branch SSE broadcast |
| **Transition Token Status** | `ReadCommitted` | `SELECT ... FOR UPDATE` on target token row | Verify tenant+branch scope, check `ALLOWED_TRANSITIONS`, update status/timestamps, enqueue milestone `NotificationEvent`s if queue advanced, `AuditLog` | `jobRunner.nudge()` + Single-pass branch SSE broadcast |
| **Claim Outbox Jobs** | `ReadCommitted` | `FOR UPDATE SKIP LOCKED` on `notification_events` | Claim batch of up to 20 due events, set `status = 'PROCESSING'`, `lockedUntil` | Parallel Web Push HTTP calls (NO DB lock held during HTTPS!) |

---

## 2. Critical Rules

1. **Never Hold DB Transactions Open During Network I/O**: VAPID Web Push calls (`web-push.sendNotification`) run strictly outside transactions.
2. **Deadlock Prevention**: Whenever locking multiple tables, follow a consistent lock order (`Branch` -> `Customer`/advisory -> `QueueCounter` -> `Token` -> `NotificationEvent`).
3. **RLS & Non-Nesting Guarantee**: All tenant transactions execute via `withTenantDb()` / `withBranchDb()` (`AsyncLocalStorage` rejects nested calls; `set_config(..., true)` clears tenant context automatically on commit or rollback).

