# Testing Strategy — SalonFlow SaaS

## 1. Multi-Layer Test Pyramid

| Suite | Tooling | Focus | Target Runtime |
| :--- | :--- | :--- | :---: |
| **Unit Tests** | Vitest | Phone normalization, timezone businessDate, strict FIFO state machine, wait-time station simulator, Zod schemas, URL/SSRF push validators | `< 3s` |
| **Integration Tests** | Vitest + Real PostgreSQL | Services + Route Handlers, multi-branch independence, RBAC permissions, Platform Admin PII masking, historical snapshots | `< 20s` |
| **Tenant Isolation Tests** | Vitest + Real PostgreSQL (Non-superuser role for RLS!) | Cross-tenant IDOR, client `organizationId` spoofing, branch-level access control, RLS policy verification | `< 10s` |
| **Concurrency & Perf Tests** | Vitest + `Promise.all` + Real PostgreSQL | Simultaneous token creations, concurrent `Call Next`, concurrent state transitions, latency SLOs, single-pass SSE DB budget | `< 15s` |
| **Notification & Outbox Tests** | Vitest + Mocked `web-push` transport | Outbox `SKIP LOCKED`, exponential backoff, `410 Gone` cleanup, anti-flap idempotency (`3 ahead`/`1 ahead`/`called`), multi-device fan-out | `< 10s` |
| **E2E & Browser Compat** | Playwright (Mobile Android/iOS emulation & Desktop) | Onboarding -> Branch QR -> Token -> SSE sync -> Optional Push opt-in -> Owner Console -> Analytics -> Admin | `< 90s` |

---

## 2. Non-Negotiable Quality Rules

1. **Test RLS Using Non-Superuser DB Connection**: Integration/isolation suites connect as an unprivileged PostgreSQL application role so RLS policies actually execute during tests.
2. **Real PostgreSQL Required**: Concurrency (`pg_advisory_xact_lock`, `ON CONFLICT DO UPDATE`, `FOR UPDATE SKIP LOCKED`, composite FKs) MUST run against PostgreSQL, never mocked in-memory DBs.
3. **Browser Push Compatibility Matrix**: Document & verify Android Chrome, Desktop Chrome/Firefox/Edge, and iOS Safari behavior (permission denied / unsupported graceful fallback).
4. **Zero Skipped Assertions**: Failing assertions must never be skipped to make CI green.
