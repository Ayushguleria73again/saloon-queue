# Background Jobs Operational Runbook (`BACKGROUND_JOBS.md`)

## 1. Worker Architecture

SalonFlow embeds an internal, concurrency-safe background job runner (`src/server/jobs/runner.ts`) inside the Node.js application process (when `OUTBOX_WORKER_ENABLED=true`) PLUS exposes `POST /api/internal/jobs/process` (protected by `CRON_SECRET`) for external cron/serverless invocation.

### Job Types
1. **`NotificationOutboxWorker`**: Claims `NotificationEvent` rows (`PENDING` / `RETRYING`) via `FOR UPDATE SKIP LOCKED` in batches of `20`, runs parallel `web-push` dispatches with `5000ms` timeout, logs `NotificationDelivery`, deactivates `404`/`410` subscriptions, and applies exponential backoff up to `DEAD_LETTER`.
2. **`EndOfDayHygieneWorker`** *(hourly check)*: Expires prior `businessDate` stale `WAITING`/`CALLED` tokens per branch timezone.
3. **`RetentionCleanupWorker`** *(daily off-peak `03:30 IST`)*: Purges expired subscriptions (`>30d`), old delivery logs (`>60d`), and anonymizes stale customer PII (`>180d`).

---

## 2. Monitoring & Manual Intervention

- **Stuck Processing Lock Recovery**: Any claimed event whose worker crashed recovers automatically once `locked_until` (`60s` lease) expires.
- **Dead-Letter Remediation**: Inspect via `/admin/jobs` (Platform Admin) or `/owner/settings/notifications` (Owner delivery logs) and re-queue via `POST .../retry`.

