# DECISIONS.md — Architecture Decision Records & Open Decisions

This document records all major architectural decisions, rationale, alternatives evaluated, and unresolved product questions for **SalonFlow**.

---

## Decision Register

| ID | Topic | Chosen / Proposed Direction | Status |
| :--- | :--- | :--- | :---: |
| `ADR-001` | Modular Monolith vs Microservices | Next.js + Prisma Modular Monolith (No Turborepo) | 🟢 Decided |
| `ADR-002` | Notification Delivery Technology | Web Push API + Service Workers + VAPID + Transactional Outbox | 🟢 Decided |
| `ADR-003` | Tenant Isolation Defense Layers | Session Context + Composite FKs + PostgreSQL RLS (`SET LOCAL`) | 🟢 Decided |
| `ADR-004` | Real-Time Transport | SSE (`EventEmitter` / `PG LISTEN-NOTIFY`) + `ETag` Polling Fallback | 🟢 Decided |
| `ADR-005` | Background Job Execution | PostgreSQL-backed Transactional Outbox + Worker Loop (`FOR UPDATE SKIP LOCKED`) | 🟢 Recommended |
| `ADR-006` | Authentication Library | Auth.js v5 (Credentials + `sessionVersion` + Tenant/Branch RBAC) | 🟢 Recommended |
| `ADR-007` | API Speed & Scalability | Pooled `DATABASE_URL` + `DIRECT_URL`, Single-Pass SSE Fan-Out, Short-TTL Cache | 🟢 Decided |
| `ADR-008` | Monetary Storage | Integer paise (`priceInPaise`) | 🟢 Decided |
| `ADR-009` | Skipped Customer Re-queue | Preserve original `SKIPPED` token; generate new FIFO sequence at back of queue | 🟢 Decided |
| `ADR-010` | Customer Self-Cancellation | Allowed ONLY while `WAITING`, configurable per branch; disabled on `CALLED`/`IN_SERVICE` | 🟢 Decided |
| `ADR-011` | Walk-In Manual Entry (MVP) | Included in MVP via `/owner/queue` using same atomic FIFO engine (`source: WALK_IN`) | 🟢 Decided |
| `ADR-012` | Hosting Architecture | Long-running Docker Node.js container on **Railway** + Managed PostgreSQL (evaluated vs Render, Fly.io, VPS) | 🟢 Decided |
| `ADR-013` | iOS Safari Web Push UX Fallback | Graceful banner guiding "Add to Home Screen" + SSE live page | 🟢 Decided |
| `ADR-014` | Multi-Station Waiting Time Estimation | Deterministic chair simulation (`activeStationsCount` + historical avg blend) | 🟢 Recommended |
| `ADR-015` | Tenant Registration Activation | Immediate `ACTIVE` status + required Email Verification + abuse/rate limits + admin controls | 🟢 Decided |

---

## Detailed Records

### `ADR-001`: Modular Monolith Without Monorepo Overhead
- **Decision**: Build a single Next.js App Router codebase with strict internal service boundaries (`src/server/services/*`). Do not introduce microservices or Turborepo.
- **Justification**: Token generation, FIFO updates, and outbox event writes require single-transaction ACID consistency. Separating services over network boundaries adds latency, operational complexity, and distributed failure modes unjustified at launch scale.

### `ADR-002`: Web Push API + Service Workers with Transactional Outbox
- **Decision**: Use standard W3C Web Push (VAPID) with a Service Worker (`/sw.js`) for both Owner/Staff alerts and opt-in Customer turn alerts, driven by a PostgreSQL `NotificationEvent` outbox.
- **Justification**: Zero per-message telecom/BSP costs across multi-tenant onboarding, instant multi-device owner push, native browser permissions tied directly to user gestures, and full compliance with customer opt-in requirements.

### `ADR-003`: Three-Tier Tenant Isolation (App + Composite FKs + PostgreSQL RLS)
- **Decision**: Enforce tenant isolation via:
  1. Server session resolution (`resolveTenantContext()`), never trusting client-supplied `organizationId`.
  2. Composite Foreign Keys (`(organizationId, branchId)`, `(organizationId, serviceId)`) in PostgreSQL so cross-tenant references fail at the DB constraint layer.
  3. PostgreSQL Row-Level Security (RLS) policies activated inside a Prisma interactive transaction wrapper (`SET LOCAL app.current_organization_id = ...`) as defense-in-depth (`TENANT_ISOLATION.md`).
- **Justification**: Multi-tenant SaaS breaches via missed `WHERE organizationId = ?` clauses are catastrophic. Layering RLS + composite keys makes cross-tenant leakage structurally impossible even if a query filter is forgotten.

### `ADR-004`: Server-Sent Events (SSE) + `ETag` Smart Polling Fallback
- **Decision**: Use SSE streams per branch (`owner/staff`) and per token (`customer`) backed by `EventEmitter` (single instance) or PostgreSQL `LISTEN/NOTIFY` via `DIRECT_URL` (multi-instance), with automatic visibility-aware polling using `ETag` (`304 Not Modified`).
- **Justification**: WebSockets require separate stateful servers behind Next.js App Router; SSE runs natively over HTTP, reconnects automatically, and respects mobile battery/network drops.

### `ADR-005`: PostgreSQL-Backed Outbox & Job Processor (Zero Extra Broker MVP)
- **Decision**: Store background jobs (`NotificationEvent` + `BackgroundJob`) directly in PostgreSQL and claim work using `SELECT ... FOR UPDATE SKIP LOCKED` inside an in-process worker loop (plus authenticated internal trigger endpoint `/api/internal/jobs/process` for external cron/serverless triggers).
- **Rationale**: Avoids adding Redis/BullMQ infrastructure in MVP while preserving strict transactional outbox guarantees, exponential backoff retries, concurrency safety across multiple workers, and dead-letter tracking. Can swap to Redis/BullMQ later behind `JobQueue` interface if throughput exceeds >500 jobs/sec.

### `ADR-006`: Auth.js v5 with Database `sessionVersion` & RBAC
- **Decision**: Use **Auth.js v5** (`Credentials` provider + Argon2id/bcrypt password hashing) issuing HTTP-only signed session cookies validated against `User.sessionVersion` and `OrganizationMember.status` in DB.
- **Justification**: Standard Next.js integration, supports instant role/access revocation when staff are removed or suspended, and keeps middleware/server authorization simple.

### `ADR-007`: Fast & Scalable API Architecture
- **Decision**:
  - Separate `DATABASE_URL` (pooled runtime connections) from `DIRECT_URL` (migrations + `LISTEN/NOTIFY`).
  - Cache branch metadata/services briefly (`15–30s` TTL) with immediate invalidation on owner edits.
  - Execute **single-pass SSE snapshot fan-out** (`1` DB query per branch event -> `O(1)` memory projection for `N` listening customers).
  - Emit weak `ETag` headers for `304` polling responses and use single-query `COUNT(*) FILTER` KPI aggregation.

### `ADR-008`: Integer Paise Currency Storage
- **Decision**: All service prices (`Service.basePriceInPaise`, `BranchService.priceOverrideInPaise`, `TokenService.priceInPaiseSnapshot`) stored as integers in paise.

### `ADR-009`: Skipped Customer Re-queue Policy (Strict FIFO)
- **Context**: A customer previously marked `SKIPPED` returns to the salon. We must preserve strict FIFO order and full audit history.
- **Decision**: When authorized staff trigger **`Re-queue`** on a `SKIPPED` token:
  1. Preserve the original `SKIPPED` token record intact (preserving `sequenceNumber`, `skippedAt`, and history).
  2. Atomically increment the branch `QueueCounter` to issue a **new queue sequence** (`requeuedFromTokenId` -> original token) placed at the back of the `WAITING` queue.
  3. Record an immutable `TOKEN_REQUEUED` `AuditLog` and enqueue `TOKEN_REQUEUED` notifications / SSE broadcast.

### `ADR-010`: Customer Self-Cancellation Policy
- **Decision**: Customers may cancel their own token **ONLY while status is `WAITING`**, controlled per branch via `SalonSettings.allowCustomerCancel` (default `true`).
- **Constraint**: Self-cancellation is **strictly disabled** once a token transitions to `CALLED` or `IN_SERVICE` (`409 SELF_CANCEL_NOT_ALLOWED`). Every cancellation writes an immutable `AuditLog` (`actorType = 'CUSTOMER'`).

### `ADR-011`: Walk-In Manual Token Registration in MVP
- **Decision**: Include manual walk-in customer registration directly from `/owner/queue` in the MVP.
- **Rules**: Walk-in entries execute the exact same `TokenService.createToken()` atomic engine, consume the branch `QueueCounter`, enter the strict FIFO queue, record `Token.source = 'WALK_IN'` (vs `'QR'`), trigger owner dashboard SSE updates, and record `AuditLog`.

### `ADR-012`: Selected Hosting Architecture (Railway vs Render vs Fly.io vs VPS)
- **Evaluated Options**: Railway, Render, Fly.io, and Self-Managed VPS (Docker + Caddy).
- **Selected Option**: **Railway (Long-Running Dockerized Node.js Container + Managed PostgreSQL)** for primary MVP launch (`DEPLOYMENT_GUIDE.md`), with zero-code-change Docker portability to **Fly.io (`bom` Mumbai)** or **Bengaluru VPS** as Indian regional traffic grows.
- **Justification**: Provides persistent Node.js processes for uninterrupted SSE streams, long-running background Web Push outbox workers, scheduled maintenance jobs, managed PostgreSQL with automated backups, and minimal DevOps overhead.

### `ADR-013`: iOS Safari Web Push Handling
- **Context**: iOS/iPadOS Safari only permits Web Push when the web app is added to the Home Screen (`standalone` PWA mode, iOS 16.4+) and permission is triggered by a user tap.
- **Decision**: Detect iOS non-standalone browser context cleanly and display a subtle instructional prompt (*"On iPhone, tap Share -> Add to Home Screen to receive lock-screen push alerts"*) while ensuring SSE live tracking on the open browser tab works identically without push.

### `ADR-014`: Multi-Station Waiting Time Calculation
- **Decision**: Track `SalonSettings.activeStationsCount` (default `1`) and combine remaining elapsed time of `IN_SERVICE` tokens + `CALLED` + `WAITING` service durations (optionally blended with rolling historical average duration per service/branch) via earliest-free-station simulation.

### `ADR-015`: New Salon Business Onboarding Activation & Verification
- **Context**: When a salon owner registers via `/register`, how should tenant activation, verification, and abuse control work?
- **Decision**:
  1. Newly registered `Organization` accounts receive **`ACTIVE`** status immediately.
  2. **Email verification is required** (`User.emailVerifiedAt`) before full owner sign-in/dashboard access.
  3. Platform Administrators retain full **suspension (`SUSPENDED`) and deactivation (`DEACTIVATED`)** controls over any organization.

### `ADR-016`: Realtime SSE Architecture with Burst Coalescing & Single-Pass Snapshot Fan-Out
- **Context**: Open browser screens (Owner `/owner/queue` and Customer `/token/[publicId]`) require sub-second live updates without manual page refreshes, while avoiding database query amplification (thundering herd) when dozens of customers simultaneously watch the same branch.
- **Decision**:
  1. **RealtimeHub Singleton**: Central hub in `src/server/realtime/hub.ts` managing branch-scoped (`branch:{organizationId}:{branchId}`) and token-scoped listener streams.
  2. **Single-Pass Projection & 50ms Coalescing (`PT-02`)**:
     - Rapid bursts of queue mutations on a branch are coalesced over a `50ms` trailing debounce window.
     - A single indexed query pass (`computeBranchWaitSnapshot`) recomputes wait times and queue positions for all active tokens in that branch.
     - Memory fan-out distributes each subscribed customer stream **strictly its own sanitized slice** (`status`, `queuePosition`, `peopleAhead`, `estimatedWaitMinutes`, `updatedAt`, `requeuedTo`), preventing cross-customer PII leakage while bounding database queries to `<= 2` even under 40+ concurrent listeners.
  3. **Resilient Client Hook (`useRealtimeStream`)**:
     - Connects via native `EventSource` with a `25s` keep-alive ping (`: ping\n\n`).
     - Resynchronizes immediately on `visibilitychange` (`visible`) and `window.online` using lightweight `If-None-Match` (`ETag`) requests (`304 Not Modified`).
     - Gracefully degrades to visibility-aware polling (`5s` active, paused hidden) if `EventSource` encounters 3 consecutive network failures.
  4. **PostgreSQL LISTEN/NOTIFY Adapter**:
     - Primary single-instance operation uses Node in-memory event fan-out with zero network hop latency.
     - Horizontal multi-instance operation (`REALTIME_TRANSPORT=pg-listen`) broadcasts mutations across container instances using PostgreSQL `LISTEN/NOTIFY` via `DIRECT_URL`.

  4. Registration enforces **abuse prevention and rate limiting** (`5 req / 1 hr` per IP, honeypot trap, disposable/spam throttling).
  5. Optional manual platform approval (`PENDING` mode) remains configurable via `REQUIRE_ADMIN_TENANT_APPROVAL` for future policy toggles.
