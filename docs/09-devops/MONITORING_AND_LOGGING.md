# Monitoring, Logging & SLO Observability

## 1. Structured JSON Logging (`pino`)

All server operations emit structured logs containing `requestId`, `module`, `organizationId` (where scoped), `branchId`, `action`, and `durationMs`.

### Strict PII & Secret Redaction
`pino` redacts `password`, `passwordHash`, `authorization`, `cookie`, `AUTH_SECRET`, `VAPID_PRIVATE_KEY`, `p256dh`, `auth`, `endpoint` tokens, and raw customer `mobileNumber` from standard info/debug logs.

---

## 2. Latency SLOs & Operational Alerts

| Signal | Warning Threshold | Critical Alert |
| :--- | :--- | :--- |
| **HTTP `5xx` Error Rate** | `> 0.5%` | `> 1%` over 5 mins |
| **Public Read Latency (`p95`)** | `> 80ms` | `> 200ms` |
| **Token Write Latency (`p95`)** | `> 150ms` | `> 400ms` |
| **Slow DB Query (`Prisma`)** | `> 100ms` logged (`warn`) | `> 500ms` investigated |
| **Outbox Dead-Letter Spike** | `>= 3` events/10m | `>= 10` events/10m |
| **Outbox Lag (Oldest `PENDING`)** | `> 30s` | `> 120s` |
| **`/api/health` Uptime Check** | Non-200 (`30s`) | Non-200 (`60s+`) |
