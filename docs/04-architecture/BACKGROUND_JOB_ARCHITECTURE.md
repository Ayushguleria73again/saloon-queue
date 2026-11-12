# Background Job Architecture (Transactional Outbox)

## 1. Why Transactional Outbox?

Writing `Token` and emitting a push notification to an external browser vendor cannot share a two-phase distributed commit. If the app creates a token and crashes 2ms later before calling `web-push`, the alert would be lost. Conversely, calling `web-push` inside the DB transaction would hold row locks for seconds.

The **Transactional Outbox Pattern** solves both:
1. Business mutation + `NotificationEvent` insert commit atomically in PostgreSQL.
2. Background worker claims and processes events asynchronously with strict concurrency locks and retries.

---

## 2. PostgreSQL Job Claiming (`FOR UPDATE SKIP LOCKED`)

```sql
WITH claimed AS (
  SELECT id
  FROM "notification_events"
  WHERE "status" IN ('PENDING', 'RETRYING')
    AND ("next_attempt_at" IS NULL OR "next_attempt_at" <= NOW())
    AND ("locked_until" IS NULL OR "locked_until" < NOW())
  ORDER BY "created_at" ASC
  LIMIT 20
  FOR UPDATE SKIP LOCKED
)
UPDATE "notification_events" e
SET
  "status" = 'PROCESSING',
  "locked_until" = NOW() + INTERVAL '60 seconds',
  "locked_by" = $1,
  "updated_at" = NOW()
FROM claimed
WHERE e.id = claimed.id
RETURNING e.*;
```

### Properties
- **Multi-Instance Safe**: Multiple app containers run the worker concurrently without ever processing the same `NotificationEvent` twice (`SKIP LOCKED`).
- **Crash Recovery**: If a worker dies mid-batch, `locked_until` expires after `60s` so another worker automatically reclaims the event.
- **Low-Latency Wakeup + Safety Poll**: Domain services trigger an immediate non-blocking in-process wakeup `jobRunner.nudge()` after commit (`< 50ms` push dispatch), backed by a `5s` safety poll interval and an authenticated `POST /api/internal/jobs/process` endpoint.

---

## 3. Retry Schedule, Backoff & Dead-Letter Handling

| Attempt | Delay After Previous Failure | Notes |
| :---: | :---: | :--- |
| 1 | `0s` (Immediate) | Triggered post-commit |
| 2 | `+15s` (with ±20% jitter) | Transient timeout / `503` |
| 3 | `+60s` | |
| 4 | `+5m` | |
| 5 (Final) | `+15m` -> `DEAD_LETTER` | Surfaces in Platform Admin `/admin/jobs` & Owner failure summary |

- **Permanent Failures (Zero Retry)**: `400`, `401`, `403`, `404`, `410` (for `404`/`410`, immediately deactivate `PushSubscription` and mark that delivery closed rather than dead-lettering).

---

## 4. Scheduled Maintenance Jobs

Alongside notification outbox processing, the job subsystem runs periodic maintenance tasks (idempotent, lock-protected):
1. **End-of-Day Stale Token Hygiene**: Expires prior `businessDate` `WAITING`/`CALLED` tokens (`AUTO_EXPIRED_END_OF_DAY`).
2. **Dead Subscription & PII Retention Sweeper**: Prunes deactivated `PushSubscription` rows (`> 30d`), purges old `NotificationDelivery` logs (`> 60d`), and anonymizes stale customer PII per `DATA_RETENTION.md`.

