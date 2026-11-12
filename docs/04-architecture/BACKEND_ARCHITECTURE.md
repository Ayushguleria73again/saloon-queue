# Backend Architecture & API Scalability

## 1. Domain Services Map

| Service | Responsibilities |
| :--- | :--- |
| **`AuthContextService`** | Resolve user session, active organization, `RolePermission` set, and `StaffBranchAccess` list. |
| **`OnboardingService`** | Atomic salon registration (`User` + `Organization` + `StaffRole`s + `Branch` + `BusinessHours` + `SalonSettings`), branch CRUD, staff invites/revocation. |
| **`CatalogService`** | Organization `Service` CRUD and per-branch `BranchService` overrides; triggers public cache invalidation on write. |
| **`BranchPublicService`** | Public branch lookup (`salonSlug` + `branchSlug`), intake eligibility (`isOpen`, `isAcceptingTokens`), cached catalog hydration, live queue wait summary. |
| **`TokenService`** | Atomic branch token generation (`QueueCounter` + `Token` + `TokenService` + `NotificationEvent` outbox + `AuditLog`), public token status, customer self-cancel. |
| **`QueueService`** | Strict FIFO `Call Next` (`FOR UPDATE SKIP LOCKED`), state machine transitions, dashboard KPIs via single conditional SQL aggregation, paginated history. |
| **`WaitTimeService`** | Deterministic multi-station wait engine + historical overrun factor calculation. |
| **`PushService`** | Save/revoke/cleanup `PushSubscription`s (owner multi-device & token-scoped customer), queue test push, query delivery attempts. |
| **`AnalyticsService`** | Tenant-scoped daily/weekly/monthly trends, top services, avg wait/service duration, multi-branch comparison. |
| **`PlatformAdminService`** | Tenant lifecycle (`ACTIVE`/`SUSPENDED`), aggregated SaaS stats, outbox backlog & DLQ diagnostics (PII redacted). |

---

## 2. Fast & Scalable API Engineering Standards

1. **Explicit Latency Targets**:
   - Public branch read: `p95 < 80ms`
   - Public token status read: `p95 < 80ms`
   - Atomic token creation: `p95 < 150ms`
   - Queue state mutations (`Call Next`, `Complete`): `p95 < 100ms`
2. **Connection Pooling (`DATABASE_URL` vs `DIRECT_URL`)**:
   - Runtime queries route through pooled `DATABASE_URL` (`PgBouncer` transaction mode / bounded Prisma pool).
   - Migrations and `LISTEN/NOTIFY` use direct unpooled `DIRECT_URL`.
   - `pg_advisory_xact_lock` is transaction-scoped—fully safe under transaction-mode pooling.
3. **Zero N+1 & Single-Query KPI Aggregation**:
   - Fetch dashboard KPIs (`Total`, `Waiting`, `Serving`, `Completed`, `Cancelled`, `Avg Wait`, `Avg Duration`) in **one SQL query** using `COUNT(*) FILTER (WHERE ...)` and `AVG(...) FILTER (WHERE ...)`.
   - Hydrate `TokenService` via batched `include`, never per-token queries.
4. **Public Read Cache with Immediate Write Invalidation**:
   - Cache static branch metadata (`Organization`, `Branch`, `BusinessHours`, `BranchService` catalog) for `15–30s` in bounded server memory (or Next.js tagged cache), invalidating immediately on `CatalogService` or `BranchService` writes. Live `waitingCount` / wait estimate remains computed fresh on indexed `tokens` columns.
5. **Single-Pass SSE Fan-Out**:
   - Broadcasts calculate `WaitTimeService` across all active branch tokens **once per branch mutation** and slice each customer's projection in memory (`O(1)` per connected client).
6. **Short-Transaction Discipline**:
   - Zod validation, phone normalization, and crypto generation happen *before* opening DB locks; push HTTP calls and SSE broadcasts happen *after* commit.
7. **Keyset / Bounded Pagination**:
   - History, analytics details, notification logs, and admin tenant lists cap `limit <= 50` and use indexed sorting.
