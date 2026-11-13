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
| `ADR-016` | Realtime SSE & Coalescing | Single-pass projection <= 2 queries for 40 listeners (`PT-02`) + 50ms coalescing | 🟢 Decided |
| `ADR-017` | Analytics Aggregations | Indexed PostgreSQL SQL aggregations under tenant RLS without PII | 🟢 Decided |
| `ADR-018` | Platform Administration | Non-PII operator governance (`IT-ADM-02`), tenant toggle (`IT-ADM-01`), dead-letter retry | 🟢 Decided |
| `ADR-019` | Security & Performance Hardening | Strict headers, sliding-window rate limits, SSRF/CSRF/honeypot defenses, `PT-01..03` latency benchmarks | 🟢 Decided |
| `ADR-020` | Production Deployment & Restore Drill | Multi-stage Docker standalone, unprivileged `app_runtime` DB role, reverse proxy SSE/SW headers, backup restore drill | 🟢 Decided |

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
  4. Registration enforces **abuse prevention and rate limiting** (`5 req / 1 hr` per IP, honeypot trap, disposable/spam throttling).
  5. Optional manual platform approval (`PENDING` mode) remains configurable via `REQUIRE_ADMIN_TENANT_APPROVAL` for future policy toggles.

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

### `ADR-017`: Tenant-Scoped Indexed Analytics Engine with SQL Aggregations
- **Context**: Salon owners and managers need daily, weekly, and monthly operational visibility (token throughput, top requested services, average wait times, service durations, completion rates, and cross-branch performance) while guaranteeing strict multi-tenant isolation, staff branch access boundaries, and sub-100ms API response times without N+1 query overhead.
- **Decision**:
  1. **Direct Indexed PostgreSQL Aggregations**:
     - Aggregate operational statistics strictly inside PostgreSQL (`withTenantDb` with `SET LOCAL app.current_organization_id`) using composite index scans on `(organization_id, branch_id, business_date)` and `(organization_id, service_id)`.
     - Employ single-query `COUNT(*) FILTER`, `AVG(EXTRACT(EPOCH FROM ...))`, and `DATE_TRUNC` to eliminate round-trips and memory overhead.
  2. **Strict Multi-Branch & Staff RBAC Scoping**:
     - Require `ANALYTICS_VIEW` permission for all analytics endpoints.
     - For `STAFF` users, automatically intersect requested branch IDs with verified `StaffBranchAccess` records. If an unpermitted branch is requested, return `403 FORBIDDEN` (or `404 NOT_FOUND` for cross-tenant branches).
  3. **Zero Customer PII Exposure**:
     - Analytics aggregates deal strictly with anonymized metrics, service snapshots, and operational timestamps. Raw customer phone numbers, names, and notes are never returned or queried.
  4. **Dynamic Granularity & Preset Intervals**:
     - Support presets: `today` (hourly/daily), `7d` (daily), `30d` (daily/weekly), `90d` (weekly/monthly), and `custom` date ranges, automatically picking optimal time bucket granularities (`day`, `week`, `month`).
  5. **Lightweight, Zero-Dependency Visualization**:
     - Deliver responsive, accessible SVG/CSS charts styled entirely with SalonFlow's semantic Tailwind design tokens (`canvas`, `surface`, `ink`, `brand`, etc.), maintaining zero client bundle bloat.

### `ADR-018`: Platform Administration, System-Wide Diagnostics, and Non-PII Operator Governance
- **Context**: SaaS platform operators require centralized controls to monitor platform health, inspect tenants, audit failed background outbox jobs, and suspend abusive or delinquent organizations without compromising customer data privacy or violating multi-tenant boundaries.
- **Decision**:
  1. **Strict Platform Admin Authentication**:
     - Access to `/admin/*` and `/api/admin/*` strictly requires `requirePlatformAdmin()` which validates `User.isPlatformAdmin === true` and session currency via `sessionVersion`.
     - Non-admin sessions attempting access receive immediate `403 FORBIDDEN` (or redirect to `/owner/dashboard`).
  2. **Non-PII Diagnostic Projections (`IT-ADM-02`)**:
     - Platform admin endpoints query through `withSystemDb` while enforcing strict field projection rules: zero customer phone numbers, customer names, or appointment notes are ever exposed in admin views or API responses.
     - Outbox job inspection surfaces sanitized event metadata (`eventType`, `attemptCount`, `status`, `lastError`, `organizationId`).
  3. **Immediate Multi-Branch Tenant Suspension (`IT-ADM-01`)**:
     - Suspending or deactivating an organization (`PATCH /api/admin/tenants/[organizationId]/status`) writes an audited state change (`TENANT_STATUS_CHANGED`).
     - Suspension status is checked at the entry point of all authenticated tenant actions and public customer token intake, immediately blocking token creation and queue transitions across all branches of that tenant with `403 TENANT_SUSPENDED`.
  4. **Self-Healing Background Job Inspection & Re-queue**:
     - The background job management view (`/admin/jobs` and `GET /api/admin/jobs`) enables operators to inspect `RETRYING` and `DEAD_LETTER` events.
     - Operators can re-queue stuck or dead-lettered events (`POST /api/admin/jobs/[eventId]/retry`), which atomically resets `status = 'PENDING'`, `attemptCount = 0`, and `nextAttemptAt = now`, triggering immediate delivery pickup by the background worker.

### `ADR-019`: Security Hardening, Edge Rate Limiting, SSRF/CSRF Defenses, and Concurrency Performance Benchmarking
- **Context**: As SalonFlow transitions toward production deployment, the platform requires multi-layered security verification against Denial of Service (DoS), Server-Side Request Forgery (SSRF), Cross-Site Request Forgery (CSRF), clickjacking, automated bot submissions, and high-concurrency race conditions, while meeting strict p95 latency targets (read < 80ms, write < 150ms) under simultaneous traffic loads.
- **Decision**:
  1. **Strict Transport & Security Headers**:
     - Configure comprehensive security headers on all responses via `next.config.ts`:
       - `X-Content-Type-Options: nosniff`
       - `X-Frame-Options: DENY`
       - `Referrer-Policy: strict-origin-when-cross-origin`
       - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
       - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
       - `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none';`
  2. **Sliding-Window Memory Rate Limiting & Tolerant Wi-Fi Scoping**:
     - Enforce `MemorySlidingWindowRateLimiter` with bounded LRU eviction (10,000 max entries) across all public, auth, and push endpoints.
     - Differentiate IP-based flood controls (`20 req / 10m` per branch) from mobile-based spam prevention (`3 req / 15m` per branch) to tolerate shared salon Wi-Fi bursts.
     - Return standard `429 Too Many Requests` responses with `Retry-After`, `X-RateLimit-Limit`, and `X-RateLimit-Remaining` headers.
  3. **Multi-Vector Threat Defenses**:
     - **CSRF Defense**: Enforce `assertSameOriginRequest` across all authenticated state mutations (`/api/owner/*`, `/api/admin/*`), validating `Origin` against `Host` headers alongside `SameSite=Lax` cookies.
     - **Honeypot Bot Trap**: Require an empty hidden `website` field on both salon registration and public intake forms; submissions with filled honeypots are rejected immediately.
     - **SSRF Defense**: Validate all push subscription endpoints via `validatePushEndpoint()`, blocking non-HTTPS URLs, localhost/loopback (`127.0.0.1`), link-local (`169.254.169.254`), and private RFC 1918 subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`).
  4. **Performance & Concurrency Latency Gate (`PT-01` – `PT-03`)**:
     - Validate latency SLOs against real PostgreSQL connection pooling:
       - Read Baseline (`PT-01`): 50 concurrent public branch reads achieve `p95 < 80ms`.
       - Write Baseline (`PT-01`): 20 burst token creation writes with advisory locks achieve `p95 < 150ms`.
       - SSE Fan-Out Budget (`PT-02`): 40 concurrent listeners receive broadcast updates with `<= 2` database queries.
       - Cache Efficiency (`PT-03`): Polling with `If-None-Match` returns `304 Not Modified` without JSON payload overhead.

### `ADR-020`: Production Deployment Architecture, Multi-Stage Containerization, Unprivileged DB Runtime, and Automated Restore Verification
- **Context**: SalonFlow requires a hardened, repeatable, and automated production deployment packaging that enforces unprivileged database runtime execution (ensuring PostgreSQL Row-Level Security cannot be bypassed), supports non-blocking Server-Sent Events (SSE) and immediate Service Worker updates, and provides automated verified backup/restore drills to meet RPO <= 24h and RTO <= 30m.
- **Decision**:
  1. **Multi-Stage Containerization (`Dockerfile`)**:
     - Implement multi-stage `node:20-alpine` build with Next.js `output: "standalone"`:
       - `deps`: Install production and build dependencies cleanly (`npm ci`).
       - `builder`: Generate Prisma client, compile Next.js standalone server and static bundles (`npm run build`).
       - `runner`: Minimal unprivileged Alpine image running as non-root user `nextjs:nodejs` (UID 1001), copying standalone output, static assets, and Prisma schema.
       - Built-in container healthcheck validating `/api/health`.
  2. **Unprivileged Database Runtime Separation**:
     - Database migrations (`prisma migrate deploy`) execute strictly via `DIRECT_URL` under the schema owner (`salonflow_admin`).
     - Application runtime and background workers connect via `DATABASE_URL` using unprivileged role `app_runtime` (`NOSUPERUSER NOBYPASSRLS`), guaranteeing that PostgreSQL Row-Level Security (`SET LOCAL app.current_organization_id`) is strictly enforced by the database engine itself.
  3. **Reverse Proxy & Gateway Configuration (`docker-compose.prod.yml` & `nginx.conf`)**:
     - Enforce unbuffered SSE streaming (`proxy_buffering off;`, `X-Accel-Buffering: no;`, `proxy_read_timeout 120s;`).
     - Enforce Service Worker update delivery (`/sw.js` with `Cache-Control: no-cache, no-store, must-revalidate` and `Service-Worker-Allowed: /`).
     - Enforce TLS/HTTPS termination with production security headers (HSTS, CSP, X-Frame-Options, X-Content-Type-Options).
  4. **Automated Backup & RLS Restore Verification Drill**:
     - Build automated snapshot scripts (`scripts/backup.sh`, `scripts/restore.sh`) generating encrypted custom-format PostgreSQL dumps (`pg_dump -Fc --no-owner --no-acl`).
     - Verification drill restores dumps into an isolated verification database, auditing that `relrowsecurity` remains enabled (`true`) across all tenant tables, testing unprivileged access, and verifying API health.
  5. **Platform Admin Initial Provisioning**:
     - Provide an idempotent, protected CLI provisioning tool (`scripts/seed-platform-admin.ts`) allowing operators to initialize or promote the primary Platform Administrator cleanly without manual database tampering.
