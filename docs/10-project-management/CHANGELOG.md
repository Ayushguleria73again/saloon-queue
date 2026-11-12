# Changelog

---

## [0.4.0 — Phase 3: Design System & Application Shell] - 2026-11-12

### Added
- Added mobile safe-area inset padding (`.pt-safe`, `.pb-safe`) and `@media print` `.no-print` styling (`src/app/globals.css`), plus INR paise and duration formatters (`src/lib/formatters.ts`).
- Built 9 semantic-token UI primitives in `src/components/ui/`: `Button`, `Input`, `Textarea`, `StatusBadge` (all 7 token statuses with Lucide icons), `ServiceCard`, `StatCard`, `ConfirmModal`, `BranchSwitcher`, and `ToastProvider`/`useToast`.
- Built isolated adaptive route shells (`src/components/layout/`: `PublicShell`, `DashboardShell` with `240px` desktop sidebar, mobile bottom nav & RBAC permission filtering, `AdminShell`) and Next.js route-group layouts (`(public)`, `(owner)`, `(admin)`).
- Added jsdom component render/accessibility tests (`tests/unit/ui-primitives.test.tsx`, `tests/unit/formatters.test.ts`).

---

## [0.3.0 — Phase 2: Authentication & Authorization] - 2026-11-12

### Added
- Configured Auth.js v5 (`next-auth`) with Edge-safe JWT session config (`src/server/auth/auth.config.ts`), Node `Credentials` handler (`src/server/auth/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`), and typed claims (`src/types/next-auth.d.ts`).
- Implemented password hashing & verification (`src/server/auth/password.ts` supporting bcrypt cost 12 and seeded `scrypt:` hashes) and credential authentication (`src/server/auth/login-service.ts`) with email normalization, email-verification check, 5-attempt 15-minute lockout, and `LOGIN_LOCKED` audit logging.
- Built sliding-window memory `RateLimiter` (`src/server/security/rate-limiter.ts`), salted IP hashing (`src/server/security/ip.ts`), and Origin/Host parity guard (`src/server/security/csrf.ts`).
- Implemented `authorizeTenantAction()` & `requirePlatformAdmin()` (`src/server/auth/rbac.ts`) enforcing `sessionVersion`, tenant `ACTIVE` status, `RolePermission` `Set`, cross-tenant `404` branch masking, and `403 BRANCH_ACCESS_DENIED`.
- Added `changeUserPassword()` (`src/server/services/account-service.ts`) & `POST /api/owner/account/password` rotating `sessionVersion` and logging `PASSWORD_CHANGED`.
- Added Edge route protection (`src/middleware.ts`, `src/server/auth/middleware-guard.ts`) and token-styled `/login` experience (`src/features/auth/`, `src/app/(auth)/login/page.tsx`).
- Added unit (`tests/unit/auth-security.test.ts`) and live PostgreSQL integration suites (`tests/integration/auth-rbac.test.ts`: lockout, `TI-01..03`, `IT-RBAC-01`, tenant suspension, immediate session revocation, platform admin guards).

---

## [0.2.1 — Surgical Bug Hunt (Phase 0 & Phase 1)] - 2026-11-12

### Fixed
- **ESLint Architectural Boundaries (`eslint.config.mjs`)**: Merged `next/headers` / `next/navigation`, `@/server/db/client`, and `@prisma/client` (`PrismaClient`) restrictions in `src/server/services/**/*.{ts,tsx}` to prevent ESLint flat-config rule replacement from silently disabling server transport isolation, and added raw Prisma client import guards to `src/app/**/*.{ts,tsx}`.
- **DB Scope Nesting Guard (`src/server/db/tenant-db.ts`, `system-db.ts`)**: Shared `AsyncLocalStorage` transaction scope tracking between `withTenantDb()`, `withBranchDb()`, and `withSystemDb()` so nested `withSystemDb -> withTenantDb` and `withSystemDb -> withSystemDb` calls throw `TenantContextError` cleanly instead of risking pool deadlocks.
- **Health Probe Timeout (`src/server/db/prisma.ts`)**: Added bounded timeout (`2500ms` default) with `clearTimeout` cleanup to `checkDatabaseHealth()` so hung database connections fail fast rather than stalling `/api/health`.
- **Environment & Error Helpers (`src/lib/env.ts`, `errors.ts`)**: Normalized empty-string optional URLs and boolean env flags to defaults while still rejecting invalid values, and added `ServiceUnavailableError` mapping `"SERVICE_UNAVAILABLE"` to HTTP `422`.
- **Timezone Business Date & Idempotent Seed (`src/lib/date.ts`, `prisma/seed.ts`)**: Added `getBusinessDateForTimezone()` (`Asia/Kolkata` aware across UTC midnight), aligned `seed.ts` business date and token re-seed updates across calendar days, and seeded org-default `SalonSettings` (`branchId: null`).

---

## [0.2.0 — Phase 1: Database & Tenant Architecture] - 2026-11-12

### Added
- Implemented all 20 normalized multi-tenant models and 9 enums in `prisma/schema.prisma` with composite foreign keys and historical snapshot fields.
- Created committed SQL migrations (`20261112142905_init_multi_tenant_schema`, `20261112143500_rls_constraints_and_permissions`) adding partial unique indexes, CHECK constraints, Force-enabled PostgreSQL RLS across 18 tenant tables, and strict `app_runtime` DML-only privileges.
- Implemented `withTenantDb()`, `withBranchDb()`, and `withSystemDb()` in `src/server/db/` with `AsyncLocalStorage` anti-nesting guards and ESLint rules blocking raw Prisma client access from `src/server/services/*`.
- Created deterministic idempotent multi-tenant seed (`prisma/seed.ts`) covering Platform Admin, Organization A (`aura-grooming` with 2 branches), and Organization B (`urban-trim` with 1 branch).
- Added and verified unit (`tests/unit/tenant-db.test.ts`), database health (`tests/integration/db-health.test.ts`), and `TI-05` PostgreSQL RLS/composite-FK/pooling isolation tests (`tests/integration/tenant-isolation.test.ts`) running as non-superuser `app_runtime`.

---

## [0.1.0 — Phase 0: Project Foundation] - 2026-11-11

### Added
- Created workspace skills in `.agent/skills/feature-architecture/SKILL.md` and `.agent/skills/surgical-bug-hunt/SKILL.md` enforcing feature-wise layout, token-based CSS, minimal code, and surgical bug-fixing.
- Resolved `ADR-015` (immediate `ACTIVE` tenant status, required email verification schema & auth endpoints, admin suspension/deactivation controls, registration abuse/rate limits).
- Initialized Next.js 15 App Router, React 19, strict TypeScript, Tailwind CSS semantic tokens (`globals.css` -> `tailwind.config.ts`), Framer Motion, and Lucide React.
- Configured ESLint with strict server/client `no-restricted-imports` boundaries, Prettier formatting, and Vitest test runner.
- Implemented foundational modules: `src/lib/env.ts`, `src/lib/config.ts`, `src/lib/errors.ts`, `src/lib/logger.ts`, `src/lib/http.ts`, `src/server/db/prisma.ts`, `src/app/api/health/route.ts`, and `tests/unit/*` (`9/9` passing).
- Prepared PostgreSQL + `app_runtime` non-superuser RLS role Docker setup (`docker-compose.yml`, `docker/postgres/init-roles.sql`) and validated `prisma/schema.prisma` (`prisma generate` passed).

---

## [Unreleased — Pre-Phase 0 SaaS Architecture] - 2026-11-10

### Added & Evolved
- Upgraded complete documentation blueprint to **SalonFlow — Multi-Tenant Salon Queue Management SaaS** across all **68 specification files**:
  - **Multi-Tenant & Branch Model**: `Organization -> Branch -> Queue` hierarchy, composite tenant foreign keys, `StaffRole`/`RolePermission`/`StaffBranchAccess` RBAC, and PostgreSQL RLS (`SET LOCAL`) defense-in-depth.
  - **Strict FIFO Queue Engine**: Branch & business-date sequence ordering (`WAITING`, `CALLED`, `IN_SERVICE`, `COMPLETED`, `SKIPPED`, `CANCELLED`, `NO_SHOW`) with `FOR UPDATE SKIP LOCKED`.
  - **Web Push & Outbox Engine**: VAPID + Service Worker (`/sw.js`) alerts for multi-device Owner/Staff AND opt-in Customers (`3 ahead`, `1 ahead`, `called`, delays) driven by PostgreSQL Transactional Outbox (`NotificationEvent` -> `Notification` -> `NotificationDelivery`), anti-flap idempotency, exponential backoff, DLQ, and `404`/`410` auto-cleanup.
  - **Fast & Scalable API Engineering**: Pooled `DATABASE_URL` + `DIRECT_URL`, single-query KPI aggregations, short-TTL catalog caching, single-pass SSE snapshot fan-out, and `ETag` `304` smart polling fallback.
  - **18-Phase Roadmap (`Phases 0–17`)** & comprehensive test suites (Tenant Isolation, Concurrency, Performance, Web Push, E2E).

### Reconciled (Architecture Review Final Product Decisions)
- Enforced exact route structure: `/`, `/register`, `/login`, `/salon/[slug]/[branch]`, `/owner/dashboard`, `/owner/branches`, `/owner/services`, `/owner/queue`, `/owner/settings`, `/admin` (removing `/dashboard` route mismatches).
- Scoped `Customer` directly per branch `(organizationId, branchId)` matching the required Organization -> Branch -> Customers/Queue/Services/QR/Notifications hierarchy.
- Included MVP **Walk-In Manual Entry** (`TokenSource: QR | WALK_IN`) via the same atomic engine and branch counter.
- Updated **Customer Self-Cancellation** strictly to `WAITING` status only (configurable per branch, disabled once `CALLED` or `IN_SERVICE`, fully audited).
- Defined **Skipped Customer Re-queue** to preserve original `SKIPPED` token history while atomically issuing a new daily sequence at the back of `WAITING` (`requeuedFromTokenId`), maintaining strict FIFO.
- Evaluated **Railway, Render, Fly.io, and VPS** in `DEPLOYMENT_GUIDE.md` and selected **Railway (Dockerized Node.js + Managed PostgreSQL)** as MVP primary host, with explicit multi-instance PostgreSQL `LISTEN/NOTIFY` guidance in `REALTIME_ARCHITECTURE.md` and Telegram documented strictly as future optional integration.
