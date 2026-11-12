# Environment Variables Reference

Validated strictly at application startup via `src/lib/env.ts` (Zod).

---

## 1. Core Database & App

| Variable | Format / Example | Secret? | Purpose |
| :--- | :--- | :---: | :--- |
| `DATABASE_URL` | `postgresql://app_user:...@host:5432/salonflow?connection_limit=20` | Yes | Pooled non-superuser runtime DB connection (enforces RLS!) |
| `DIRECT_URL` | `postgresql://migrator:...@host:5432/salonflow` | Yes | Unpooled connection for Prisma migrations & `LISTEN/NOTIFY` |
| `NEXT_PUBLIC_APP_URL` | `https://app.salonflow.in` | No | Canonical base URL for QR codes & push origin |
| `AUTH_SECRET` | `openssl rand -base64 32` | Yes | Auth.js v5 cookie signing & encryption |
| `AUTH_URL` | `https://app.salonflow.in` | No | Auth.js canonical callback URL |
| `IP_HASH_SALT` | `openssl rand -hex 32` | Yes | HMAC salt for `AuditLog` & rate limiting |

---

## 2. Web Push (VAPID) & Background Jobs

| Variable | Format / Example | Secret? | Purpose |
| :--- | :--- | :---: | :--- |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | URL-safe base64 VAPID public key | No | Browser `pushManager.subscribe()` applicationServerKey |
| `VAPID_PRIVATE_KEY` | URL-safe base64 VAPID private key | Yes | Signing VAPID JWT headers on server (NEVER expose to client!) |
| `VAPID_SUBJECT` | `mailto:alerts@salonflow.in` | No | Contact URI required by push services |
| `OUTBOX_WORKER_ENABLED` | `true` \| `false` | No | Enables in-process outbox polling loop in long-running Node host |
| `OUTBOX_POLL_INTERVAL_MS` | `5000` | No | Fallback safety poll interval |
| `CRON_SECRET` | `openssl rand -hex 24` | Yes | Bearer secret for `/api/internal/jobs/process` |

---

## 3. SaaS & Infrastructure Controls

| Variable | Default / Example | Secret? | Purpose |
| :--- | :--- | :---: | :--- |
| `REALTIME_TRANSPORT` | `memory` \| `pg-listen` | No | `memory` single-node, `pg-listen` multi-instance (`DIRECT_URL`) |
| `REQUIRE_ADMIN_TENANT_APPROVAL` | `false` | No | `true` sets new registrations to `PENDING`; `false` activates immediately |
| `PII_RETENTION_DAYS` | `180` | No | Anonymization threshold for inactive customers |
| `TEST_DATABASE_URL` | `postgresql://app_user:...@localhost:5432/salonflow_test` | Yes | Non-superuser PostgreSQL DB for Vitest isolation & concurrency tests |
| `LOG_LEVEL` | `info` | No | Pino log level |
