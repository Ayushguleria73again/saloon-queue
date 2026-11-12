# Development Phases Specification (Phases 0 – 17)

---

## Phase 0: Project Foundation
- **Objectives**: Initialize modular monolith Next.js App Router codebase, strict TypeScript tooling, logging, typed errors, and local Postgres compose setup.
- **Dependencies**: Stakeholder approval of `DECISIONS.md` and `docs/`.
- **Technical Tasks**:
  - Scaffold Next.js + TypeScript + Tailwind CSS + Framer Motion + Lucide React + Zod + Pino + Vitest.
  - Enable `strict: true`, `noUncheckedIndexedAccess: true` in `tsconfig.json`.
  - Implement `src/lib/env.ts`, `src/lib/logger.ts`, `src/lib/errors.ts`, `GET /api/health`, and `docker-compose.yml`.
- **Expected Deliverables**: Bootable codebase, health endpoint, Docker PostgreSQL setup.
- **Acceptance Criteria**: `npm run typecheck`, `lint`, and `build` pass cleanly; `/api/health` returns `200`.
- **Testing Requirements**: Unit tests for `AppError` and env validation; health endpoint check.
- **Completion Status**: `🟢 Complete` (Verified 2026-11-11: `prisma validate`/`generate`, `tsc --noEmit`, `eslint`, `prettier`, `vitest` 9/9, `next build`, `docker compose config`)

---

## Phase 1: Database and Tenant Architecture
- **Objectives**: Implement the normalized multi-tenant PostgreSQL schema, composite FKs, RLS policies, and idempotent seed.
- **Dependencies**: Phase 0.
- **Technical Tasks**:
  - Author `prisma/schema.prisma` for all 19+ entities (`User`, `Organization`, `OrganizationMember`, `Branch`, `StaffRole`, `RolePermission`, `StaffBranchAccess`, `Customer`, `Service`, `BranchService`, `Token`, `TokenService`, `QueueCounter`, `PushSubscription`, `Notification`, `NotificationEvent`, `NotificationDelivery`, `BusinessHours`, `SalonSettings`, `AuditLog`).
  - Configure `DATABASE_URL` + `DIRECT_URL` + non-superuser `app_runtime` DB role.
  - Create Prisma SQL migration with partial unique indexes and PostgreSQL RLS policies (`TENANT_ISOLATION.md`).
  - Build `withTenantDb(organizationId, fn)` setting `SET LOCAL app.current_organization_id`, plus `prisma/seed.ts` (2 tenants, 3 branches, Platform Admin).
- **Expected Deliverables**: Schema, SQL migrations (with RLS), `src/server/db/`, idempotent multi-tenant seed.
- **Acceptance Criteria**: Migrations run cleanly on empty DB; seed is idempotent; RLS verified blocking un-scoped writes/reads under `app_runtime`.
- **Testing Requirements**: `TI-05` RLS isolation test + schema constraint verification.
- **Completion Status**: `🟢 Complete` (Verified 2026-11-12: migrations deployed on `salonflow` & `salonflow_test`, idempotent `seed.ts` x2, `TI-05` 8/8 + DB health + 13/13 unit tests, `tsc`, `eslint`, `prettier`)

---

## Phase 2: Authentication and Authorization
- **Objectives**: Implement secure session authentication, brute-force lockout, granular RBAC, and branch access guards.
- **Dependencies**: Phase 1.
- **Technical Tasks**:
  - Configure Auth.js v5 (`Credentials` + `argon2`/`bcryptjs`), `sessionVersion` verification, 5-attempt account lockout (`15m`).
  - Build `authorizeTenantAction({ requiredPermission, branchId? })` and `requirePlatformAdmin()`.
  - Build `/login` UI and `src/middleware.ts` route guards.
- **Expected Deliverables**: `src/server/auth/`, RBAC guard, login screen.
- **Acceptance Criteria**: Unauthenticated requests rejected (`401`); cross-tenant requests return `404`; unassigned branch requests return `403`.
- **Testing Requirements**: `TI-01`, `TI-02`, `TI-03`, `IT-RBAC-01`, lockout integration tests.
- **Completion Status**: `🟢 Complete` (Verified 2026-11-12: Auth.js v5 Credentials + lockout, `authorizeTenantAction`/`requirePlatformAdmin`, `middleware.ts`, `/login`, `POST /api/owner/account/password`, `tests/unit` 32/32, `tests/integration` 17/17, `tsc`, `eslint`, `prettier`, `next build`)

---

## Phase 3: Design System and Application Shell
- **Objectives**: Build mobile-first design tokens, reusable UI primitives, and isolated route layouts (`public`, `dashboard`, `admin`).
- **Dependencies**: Phase 0.
- **Technical Tasks**:
  - Configure Tailwind theme colors, `Plus Jakarta Sans` + `JetBrains Mono`, safe-area padding.
  - Build `src/components/ui/`: `Button`, `Input`, `Textarea`, `StatusBadge` (7 statuses), `ServiceCard`, `StatCard`, `ConfirmModal`, `BranchSwitcher`, `Toast`.
  - Build responsive Dashboard shell (mobile bottom nav + desktop sidebar) and minimal Public layout.
- **Expected Deliverables**: Design system primitives and route group shells.
- **Acceptance Criteria**: Clean layout at `360px` and `1280px`; inputs >= `16px`, buttons >= `48px` touch height; `prefers-reduced-motion` honored.
- **Testing Requirements**: Component render/accessibility tests for `ServiceCard`, `StatusBadge`, `ConfirmModal`.
- **Completion Status**: `🟢 Complete` (Verified 2026-11-12: 9 semantic-token UI primitives, `PublicShell`/`DashboardShell`/`AdminShell`, route-group layouts, `ui-primitives.test.tsx` & `formatters.test.ts`, `tsc`, `eslint`, `prettier`, `next build`)

---

## Phase 4: Salon Onboarding and Branch Management
- **Objectives**: Enable salon self-registration, multi-branch CRUD, business hours configuration, and staff invitation/RBAC management.
- **Dependencies**: Phases 1, 2, 3.
- **Technical Tasks**:
  - Implement `OnboardingService` (`POST /api/auth/register-salon`, `/register` page).
  - Implement Branch CRUD + 7-day `BusinessHours` + branch `SalonSettings` (`/owner/branches`).
  - Implement Staff invite tokens, `/invite/[token]` acceptance, branch assignment (`StaffBranchAccess`), and immediate member revocation (`/owner/staff`).
- **Expected Deliverables**: Registration flow, Branch Studio, Staff & RBAC management UI/APIs.
- **Acceptance Criteria**: Newly registered salon receives default roles and Main Branch immediately; staff revocation invalidates session immediately.
- **Testing Requirements**: `IT-ONB-01`, staff revocation & branch assignment tests.
- **Completion Status**: `⚪ Not Started`

---

## Phase 5: Services Management
- **Objectives**: Build organization service catalog and per-branch `BranchService` availability, pricing, and duration overrides.
- **Dependencies**: Phases 1, 2, 4.
- **Technical Tasks**:
  - Implement `CatalogService` + `/api/owner/services` + `/api/owner/branches/[branchId]/services/[serviceId]`.
  - Add short-TTL public catalog cache with automatic write-through invalidation.
  - Build `/owner/services` UI with branch override controls and soft-delete confirmation.
- **Expected Deliverables**: Services CRUD + per-branch availability/override matrix.
- **Acceptance Criteria**: Deactivating or repricing a service updates public branch intake immediately without changing historical `TokenService` rows.
- **Testing Requirements**: `IT-BRN-02` (branch price isolation + snapshot integrity).
- **Completion Status**: `⚪ Not Started`

---

## Phase 6: Public QR Customer Interface
- **Objectives**: Deliver zero-friction public branch page `/salon/[salonSlug]/[branchSlug]` with branch status, cached services, and validated intake form.
- **Dependencies**: Phases 3, 4, 5.
- **Technical Tasks**:
  - Implement `BranchPublicService` + `GET /api/public/salons/[salonSlug]/[branchSlug]`.
  - Build `/salon/[salonSlug]/[branchSlug]/page.tsx` + `CustomerIntakeForm` (Name, `+91` Mobile, multi-select `ServiceCard`s, Notes, honeypot, sticky checkout bar, local active-token shortcut).
- **Expected Deliverables**: Public branch intake page & API endpoint.
- **Acceptance Criteria**: Suspended tenants/inactive branches show unavailable message; closed hours display branch schedule; invalid Indian phone rejected inline.
- **Testing Requirements**: Unit tests (`UT-PHN-01..04`, `UT-DAT-01..03`), `TI-04` (cross-branch service injection blocked).
- **Completion Status**: `⚪ Not Started`

---

## Phase 7: Token Generation Engine
- **Objectives**: Implement atomic daily branch token generation, duplicate active token guard, wait-time engine, and outbox enqueueing.
- **Dependencies**: Phases 1, 6.
- **Technical Tasks**:
  - Implement `WaitTimeService` (multi-station simulation + optional historical overrun blend).
  - Implement `TokenService.createToken()` (`pg_advisory_xact_lock`, `QueueCounter` `ON CONFLICT DO UPDATE`, 128-bit `publicId`, `TokenService` snapshots, `NotificationEvent` outbox write, `AuditLog`).
  - Wire `POST /api/public/salons/[salonSlug]/[branchSlug]/tokens`.
- **Expected Deliverables**: `TokenService`, `WaitTimeService`, public token creation API.
- **Acceptance Criteria**: Parallel submissions across branches yield strictly unique sequential tokens (`A001`..`A025` independently per branch); duplicate active phone rejected without PII leak.
- **Testing Requirements**: `UT-WT-01..04`, `IT-BRN-01`, `IT-PUB-01..02`, `CT-01..04`.
- **Completion Status**: `⚪ Not Started`

---

## Phase 8: FIFO Queue Management Engine
- **Objectives**: Build the strict FIFO queue transition engine, concurrent `Call Next`, walk-in manual entry, skipped re-queue, targeted transitions, and branch history API.
- **Dependencies**: Phases 2, 7.
- **Technical Tasks**:
  - Implement `QueueService.callNext()` (`FOR UPDATE SKIP LOCKED`, `sequenceNumber ASC`).
  - Implement `QueueService.createWalkInToken()` (`source = 'WALK_IN'`, calling `TokenService.createToken()`) and `QueueService.requeueSkippedToken()` (preserves `SKIPPED` original token + issues new `QueueCounter` sequence at back of `WAITING` + records `TOKEN_REQUEUED`).
  - Implement `QueueService.transitionToken()` enforcing 7-status matrix (`WAITING`, `CALLED`, `IN_SERVICE`, `COMPLETED`, `SKIPPED`, `CANCELLED`, `NO_SHOW`), emitting threshold outbox events and `AuditLog`.
  - Implement `GET /api/owner/branches/[branchId]/history` with bounded cursor/indexed pagination.
- **Expected Deliverables**: `QueueService`, walk-in & re-queue APIs, `/owner/history`.
- **Acceptance Criteria**: Simultaneous `Call Next` calls never double-call the same token; walk-ins share same FIFO queue/counter; skipped re-queue creates new tail sequence preserving original history; invalid transitions return `409`.
- **Testing Requirements**: `UT-STM-01..05`, `IT-QUE-01..02`, `CT-05`, `CT-06`.
- **Completion Status**: `⚪ Not Started`

---

## Phase 9: Customer Token Tracking
- **Objectives**: Deliver unguessable live ticket confirmation & status screen `/salon/[salonSlug]/[branchSlug]/token/[publicId]`.
- **Dependencies**: Phases 6, 7.
- **Technical Tasks**:
  - Implement `GET /api/public/tokens/[publicId]` (with `ETag` `304`, masked phone, requeue redirect link if applicable) and `POST /api/public/tokens/[publicId]/cancel` (allowed ONLY while `WAITING` & branch `allowCustomerCancel = true`; audited).
  - Build ticket page showing required confirmation messages (`"Your token has been generated successfully!"` / `"Please wait for your turn. We will notify you when your turn is approaching."`), huge token number, position, approx wait time, services, and self-cancel modal.
- **Expected Deliverables**: Public token tracking page & APIs.
- **Acceptance Criteria**: Raw phone never exposed publicly; `If-None-Match` returns `304`; self-cancel works ONLY in `WAITING` and is blocked/disabled in `CALLED` / `IN_SERVICE`.
- **Testing Requirements**: `IT-PUB-03`, `IT-PUB-05`, `TI-06`.
- **Completion Status**: `⚪ Not Started`

---

## Phase 10: Owner Dashboard & QR Studio
- **Objectives**: Build the responsive Owner/Staff dashboard console (`/owner/dashboard`, `/owner/queue`, KPIs, `+ Add Walk-In`, `Re-queue`) and QR Studio (`/owner/qr`).
- **Dependencies**: Phases 2, 3, 8.
- **Technical Tasks**:
  - Implement `GET /api/owner/branches/[branchId]/queue` using single SQL conditional aggregation for all 7 KPIs + `ETag` support.
  - Build `/owner/dashboard` and `/owner/queue` UI with `Call Next`, `+ Add Walk-In` modal, card actions, `Re-queue` on skipped items, plus `/owner/settings` and `/owner/qr` (PNG download, printable standee, copy URL, rotate QR).
- **Expected Deliverables**: Owner Dashboard, Live Queue Console, Settings UI, QR Studio (`QrService`).
- **Acceptance Criteria**: Staff see only assigned branches & permitted buttons; downloaded QR scans directly to `/salon/{s}/{b}`; print view renders cleanly.
- **Testing Requirements**: `E2E-01`, `E2E-02`, `E2E-04`, `E2E-05`.
- **Completion Status**: `⚪ Not Started`

---

## Phase 11: Web Push Infrastructure and Owner Notifications
- **Objectives**: Implement Service Worker (`/sw.js`), VAPID Web Push provider, transactional outbox background worker, and multi-device owner/staff notifications.
- **Dependencies**: Phases 1, 2, 7.
- **Technical Tasks**:
  - Install `web-push`, generate/configure VAPID env vars, author `public/sw.js` (notification display, click routing, optional ack).
  - Build `NotificationOutboxWorker` (`FOR UPDATE SKIP LOCKED`, exponential backoff, `DEAD_LETTER`, `404`/`410` auto-cleanup).
  - Implement `/api/owner/push-subscriptions`, test push endpoint, `/api/internal/jobs/process`, and `/owner/settings/notifications`.
- **Expected Deliverables**: Service worker, outbox worker, owner push onboarding & delivery logs UI.
- **Acceptance Criteria**: New customer token pushes alert to all active owner/staff devices for that branch within seconds; `410` endpoints auto-deactivate; token creation succeeds even if push service fails.
- **Testing Requirements**: `UT-PSH-01..02`, `NT-01`, `NT-02`, `NT-04`, `NT-05`, `NT-06`.
- **Completion Status**: `⚪ Not Started`

---

## Phase 12: Customer Push Notifications
- **Objectives**: Implement optional post-token customer Web Push subscription and anti-flap turn milestone notifications (`3 ahead`, `1 ahead`, `called`, delays).
- **Dependencies**: Phases 8, 9, 11.
- **Technical Tasks**:
  - Implement `POST|DELETE /api/public/tokens/[publicId]/push-subscription` and `POST /api/public/push/ack`.
  - Add milestone evaluator inside `QueueService` writing idempotent `NotificationEvent`s (`token:{id}:APPROACHING_3`, `APPROACHING_1`, `CALLED`).
  - Build user-initiated opt-in card on `/token/[publicId]` with iOS Add-to-Home-Screen hint and graceful denied fallback.
- **Expected Deliverables**: Customer push endpoints, milestone evaluator, opt-in UI.
- **Acceptance Criteria**: Zero permission prompts before token creation; milestone alerts fire at most once even under queue fluctuations; denied permission never breaks status tracking.
- **Testing Requirements**: `NT-03`, `IT-PUB-04`, `E2E-03`.
- **Completion Status**: `⚪ Not Started`

---

## Phase 13: Real-Time Queue Updates
- **Objectives**: Implement tenant/branch-scoped SSE streaming with single-pass snapshot fan-out and automatic `ETag` polling fallback.
- **Dependencies**: Phases 8, 9, 10.
- **Technical Tasks**:
  - Implement `RealtimeHub` (`EventEmitter` + PostgreSQL `LISTEN/NOTIFY` over `DIRECT_URL`) with `50ms` burst coalescing and **single-query projection fan-out**.
  - Wire `GET /api/owner/branches/[branchId]/queue/events` and `GET /api/public/tokens/[publicId]/events`.
  - Build `useRealtimeStream` hook (`visibilitychange`, `online`, `ETag` fallback).
- **Expected Deliverables**: SSE streams, realtime hub, resilient client hooks.
- **Acceptance Criteria**: Owner & Customer pages update in `< 1s` without refresh; 40 concurrent SSE subscribers trigger `<= 2` DB queries per queue change (`PT-02`).
- **Testing Requirements**: `PT-02`, `PT-03`, Playwright two-context live sync (`E2E-01`).
- **Completion Status**: `⚪ Not Started`

---

## Phase 14: Analytics and Reporting
- **Objectives**: Deliver tenant-scoped operational analytics (daily/weekly/monthly trends, top services, avg wait/service durations, branch comparisons).
- **Dependencies**: Phases 2, 8, 10.
- **Technical Tasks**:
  - Implement `AnalyticsService` using indexed SQL aggregations over `tokens` & `token_services` strictly filtered by `organizationId` and permitted `branchIds`.
  - Build `GET /api/owner/analytics` and `/owner/analytics` UI.
- **Expected Deliverables**: Analytics API & responsive visualization page.
- **Acceptance Criteria**: Branch comparisons & trends match historical token totals accurately; staff lacking `ANALYTICS_VIEW` or branch access are blocked.
- **Testing Requirements**: `IT-ANA-01`, cross-tenant analytics isolation test.
- **Completion Status**: `⚪ Not Started`

---

## Phase 15: Platform Administration
- **Objectives**: Build `/admin` console for SaaS operators to monitor platform health, activate/suspend tenants, and inspect failed/dead-letter jobs without customer PII exposure.
- **Dependencies**: Phases 1, 2, 14.
- **Technical Tasks**:
  - Implement `PlatformAdminService` + `/api/admin/*` routes (`overview`, `tenants`, `status` toggle, `jobs`, `retry`).
  - Build `/admin`, `/admin/tenants`, and `/admin/jobs` UIs.
- **Expected Deliverables**: Platform Admin portal & APIs.
- **Acceptance Criteria**: Suspending a tenant immediately halts public intake and owner mutations; admin endpoints contain zero raw customer mobile numbers/names.
- **Testing Requirements**: `IT-ADM-01`, `IT-ADM-02`, `E2E-05`.
- **Completion Status**: `⚪ Not Started`

---

## Phase 16: Security, Concurrency and Performance Testing
- **Objectives**: Implement full rate-limiting, CSP/CSRF headers, SSRF guards, and pass the complete automated verification suite including latency benchmarks.
- **Dependencies**: Phases 1–15.
- **Technical Tasks**:
  - Enforce `RateLimiter` (`RATE_LIMITING.md`), CSP/HSTS/anti-clickjacking headers, Origin CSRF checks, honeypot bot guard.
  - Execute complete Vitest (unit, integration, tenant-isolation, concurrency, notification, latency `PT-01..03`) and Playwright mobile/desktop E2E suites.
- **Expected Deliverables**: Hardened production middleware & verified test pass report.
- **Acceptance Criteria**: `0` TS/lint errors, all concurrency/isolation/notification/E2E suites green, `PT-01` read `p95 < 80ms` / write `p95 < 150ms`.
- **Testing Requirements**: Full CI gate + security checklist audit.
- **Completion Status**: `⚪ Not Started`

---

## Phase 17: Production Deployment
- **Objectives**: Package and deploy SalonFlow SaaS with SSL/Service-Worker headers, non-superuser DB runtime role, automated backups, and monitoring.
- **Dependencies**: Phase 16.
- **Technical Tasks**:
  - Create multi-stage `Dockerfile`, `docker-compose.prod.yml`, reverse proxy config (`sw.js` no-cache + SSE unbuffered).
  - Provision PostgreSQL `app_runtime` role, run `prisma migrate deploy`, seed initial Platform Admin, run backup + RLS restore verification drill.
  - Verify live HTTPS QR scan, Web Push on Android + Desktop, and health alerting.
- **Expected Deliverables**: Production deployment config, live verified platform, final `PROJECT_STATUS.md` & `CHANGELOG.md`.
- **Acceptance Criteria**: Live `/api/health` green, end-to-end mobile push verified over HTTPS, backup & RLS restore verified.
- **Testing Requirements**: Production smoke & restore checklist pass.
- **Completion Status**: `⚪ Not Started`
