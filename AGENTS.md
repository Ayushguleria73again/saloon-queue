# AGENTS.md — SalonFlow Engineering Rules & Standards

Mandatory rules for every AI coding agent and human engineer working on **SalonFlow**.

---

## 1. Core Engineering Rules

1. **Documentation First**: Never implement code before architectural design, schema, API contracts, and decisions are documented in `docs/` and `DECISIONS.md`. Update docs whenever requirements evolve.
2. **Strict Separation of Concerns**:
   - Keep domain and business logic exclusively inside `src/server/services/` and pure domain libraries inside `src/lib/`.
   - Keep React Server Components, Client Components, Route Handlers, and Server Actions thin: authenticate -> resolve tenant context -> validate via Zod -> invoke domain service -> map errors -> return response.
3. **Tenant Isolation Everywhere**:
   - NEVER trust `organizationId`, `tenantId`, or `branchId` submitted directly by unverified client payloads for authenticated tenant writes/reads.
   - Resolve `organizationId` exclusively from the authenticated session (`session.user.activeOrganizationId`) or from validated public slugs (`/salon/{salonSlug}/{branchSlug}`) or opaque token `publicId`.
   - Enforce composite tenant keys (`organizationId`, `branchId`), service-layer tenant checks, and PostgreSQL RLS context (`SET LOCAL app.current_organization_id`) where applicable.
   - Verify `StaffBranchAccess` and `RolePermission` before executing branch-scoped owner/staff operations.
4. **Strict TypeScript**:
   - `"strict": true`, `"noUncheckedIndexedAccess": true`, `"noImplicitAny": true`.
   - Avoid `any`; explain rare edge cases explicitly if unavoidable.
5. **Atomic Database Transactions & Concurrency**:
   - Token creation (`QueueCounter` increment, duplicate guard, customer upsert, `Token`, `TokenService` snapshots, `NotificationEvent` outbox insert, `AuditLog`) MUST run inside one ACID `prisma.$transaction`.
   - Queue mutations (`Call Next`, state transitions) MUST use row locks (`FOR UPDATE SKIP LOCKED` / `FOR UPDATE`) and validate transitions deterministically.
6. **Reliable Non-Blocking Notifications (Transactional Outbox)**:
   - NEVER couple token validity to Web Push delivery success.
   - Write `NotificationEvent` atomically inside the business transaction; process deliveries asynchronously via background worker with retries, exponential backoff, dead-letter handling, and expired (`404`/`410`) subscription cleanup.
7. **Fast & Scalable APIs**:
   - Eliminate N+1 queries via batched joins and single-query SQL conditional KPI aggregations.
   - Use `ETag`/`304` on polling fallbacks, single-pass SSE snapshot fan-out, short-TTL catalog caching with write invalidation, and bounded keyset/cursor pagination.
8. **No Fake Implementations or Untested Claims**:
   - Never leave placeholder stubs in auth, RBAC, rate limiters, or push workers.
   - Update `PROJECT_STATUS.md` and `docs/10-project-management/CHANGELOG.md` after every verified phase.

---

## 2. Target Repository Layout (Post-Approval)

```text
/
├── docs/                           # Complete SaaS documentation (01..10)
├── prisma/
│   ├── schema.prisma               # Multi-tenant PostgreSQL schema
│   ├── migrations/                 # Committed SQL migrations (incl. RLS policies)
│   └── seed.ts                     # Idempotent multi-tenant dev seed
├── public/
│   └── sw.js                       # Service Worker for Web Push & notification clicks
├── src/
│   ├── app/
│   │   ├── (public)/salon/[salonSlug]/[branchSlug]/
│   │   ├── (auth)/                 # /login, /register, /invite/[token]
│   │   ├── (owner)/owner/          # /owner/dashboard, /branches, /services, /queue, /settings
│   │   ├── (admin)/admin/          # /admin Platform Administrator portal
│   │   └── api/                    # Public, Owner, Admin, Auth, Push, Health endpoints
│   ├── components/ui/              # Stateless token-styled UI primitives
│   ├── features/                   # Feature-wise modules (queue, tokens, branches, services, push, analytics, admin)
│   ├── lib/                        # Zod schemas, formatters, date/FIFO utilities, logger
│   └── server/
│       ├── auth/                   # Auth.js session config, password hash, RBAC guard
│       ├── db/                     # Prisma client, RLS transaction wrapper, raw locks
│       ├── jobs/                   # Outbox background job processor & workers
│       ├── notifications/          # Web Push VAPID adapter, outbox dispatcher, cleanup
│       ├── realtime/               # Single-pass SSE hub + PG LISTEN/NOTIFY
│       ├── security/               # Rate limiter, crypto publicId, IP hashing, headers
│       └── services/               # Pure multi-tenant domain services
└── tests/                          # Unit, integration, tenant-isolation, concurrency, push, E2E
```

---

## 3. Domain Constants & Rules

- **Currency**: Store prices as integer **paise** (`priceInPaise`, e.g., ₹250 = `25000`).
- **Phone Numbers**: Normalize and validate Indian 10-digit numbers (`^[6-9]\d{9}$`); mask on public customer views (`******3210`).
- **FIFO Ordering**: Deterministic sequence order (`sequenceNumber ASC`) per `(branchId, businessDate)`. No manual reordering or VIP overrides in v1.
- **No Unnecessary Tooling**: Modular monolith only; no Turborepo, no microservices.
