# PROJECT_STATUS.md — SalonFlow Implementation Tracker

**Last Updated**: 2026-11-13  
**Current Stage**: Phase 12 Complete & Bug Hunt Verified — Ready for Phase 13  
**Overall Status**: 🟢 Phase 12 & Bug Hunt Verified & Complete — Ready for Phase 13 (Real-Time Queue Updates)

---

## Phase Completion Tracker (Phases 0 – 17)

| Phase | Title | Status | Gate Notes |
| :---: | :--- | :---: | :--- |
| **Pre-0** | **SaaS Documentation & Architecture** | 🟢 Complete | All 68 specification files reconciled & validated |
| **0** | Project foundation | 🟢 Complete | Next.js 15, Tailwind tokens, Prisma init, ESLint boundaries, Docker config, `tsc`/`lint`/`format`/`test`/`build` green |
| **1** | Database and tenant architecture | 🟢 Complete | 20 Prisma models, composite FKs, 18 RLS policies, `withTenantDb()`, idempotent seed, `TI-05` & DB checks green |
| **2** | Authentication and authorization | 🟢 Complete | Auth.js v5 JWT/Credentials, 5-attempt lockout + `LOGIN_LOCKED` audit, `authorizeTenantAction()`, `requirePlatformAdmin()`, `middleware.ts`, `/login`, `TI-01..03` & `IT-RBAC-01` green |
| **3** | Design system and application shell | 🟢 Complete | Token-based Tailwind UI (`Button`, `Input`, `Textarea`, `StatusBadge`, `ServiceCard`, `StatCard`, `ConfirmModal`, `BranchSwitcher`, `Toast`), `PublicShell`/`DashboardShell`/`AdminShell`, route layouts, jsdom a11y/render tests green |
| **4** | Salon onboarding and branch management | 🟢 Complete | Self-serve `/register`, email verification, Branch CRUD + 7-day `BusinessHours` + service inheritance (`/owner/branches`), Staff invites `/invite/[token]` + branch assignment + immediate revocation (`/owner/staff`), `IT-ONB-01` & integration tests green |
| **5** | Services management | 🟢 Complete | `CatalogService`, `BranchCatalogCache` (20s TTL + write-through invalidation), `/api/owner/services`, `/api/owner/branches/[branchId]/services/[serviceId]`, `/owner/services`, `IT-BRN-02` & unit/integration suites green |
| **6** | Public QR customer interface | 🟢 Complete | `BranchPublicService`, `GET /api/public/salons/[salonSlug]/[branchSlug]`, `/salon/[salonSlug]/[branchSlug]`, `CustomerIntakeForm`, `phone.ts`, `date.ts`, `wait-time.ts`, `UT-PHN-01..04`, `UT-DAT-01..03`, `UT-WT-01..04`, `TI-04` green |
| **7** | Token generation engine | 🟢 Complete | `WaitTimeService` (station sim + clamped 30d overrun), `TokenService` (`pg_advisory_xact_lock`, atomic `QueueCounter`, 128-bit `publicId`, `TokenService` snapshots, `NotificationEvent` outbox, `AuditLog`), `POST /api/public/salons/[salonSlug]/[branchSlug]/tokens`, `IT-PUB-01..02`, `IT-BRN-01`, `CT-01..04` green |
| **8** | FIFO queue management engine | 🟢 Complete | `queue-state-machine.ts`, `QueueService` (`callNextToken` `FOR UPDATE SKIP LOCKED`, `createWalkInToken`, `requeueSkippedToken`, `transitionBranchToken` `FOR UPDATE`, `getBranchQueueOverview` single-SQL KPIs, `getBranchTokenHistory` cursor pagination), 6 `/api/owner/branches/[branchId]/*` queue/history routes, `UT-STM-01..05`, `IT-QUE-01..02`, `CT-05`, `CT-06` green |
| **9** | Customer token tracking | 🟢 Complete | `token-tracking-service.ts`, `GET /api/public/tokens/[publicId]` (`ETag`/`304`, masked phone, requeue link), `POST /api/public/tokens/[publicId]/cancel` (`WAITING`-only audited self-cancel), `/salon/[salonSlug]/[branchSlug]/token/[publicId]` (`TokenTrackerView`), `IT-PUB-03`, `IT-PUB-05`, `TI-06` green |
| **10** | Owner dashboard & QR studio | 🟢 Complete | `QrService` (`qrcode` PNG/SVG/dataUrl + `?t` rotation), `/api/owner/branches/[branchId]/qr` + `/qr/regenerate`, live `/owner/dashboard`, `/owner/queue` (`LiveQueueConsole` KPIs, `Call Next`, Walk-In modal, status transitions, `Re-queue`), `/owner/history`, `/owner/qr` (`.no-print` counter standee), `/owner/settings`, unit/component + live PG `QrService` tests green |
| **11** | Web Push infrastructure and owner notifications | 🟢 Complete | `web-push` + VAPID env setup, `public/sw.js`, `NotificationOutboxWorker` (`FOR UPDATE SKIP LOCKED`, `15s/60s/300s/900s` retries, `DEAD_LETTER`, `404`/`410` auto-cleanup), `/api/owner/push-subscriptions`, test push, `/api/owner/notifications`, `/api/internal/jobs/process` (`CRON_SECRET`), `/owner/settings/notifications`, `UT-PSH-01..02`, `NT-01`, `NT-02`, `NT-04`, `NT-05`, `NT-06` green |
| **12** | Customer push notifications | 🟢 Complete | `CustomerPushOptInCard` on `/token/[publicId]`, `POST|DELETE /api/public/tokens/[publicId]/push-subscription`, `POST /api/public/push/ack`, milestone evaluator in `QueueService` (`CUSTOMER_APPROACHING_3`, `CUSTOMER_APPROACHING_1`, `TOKEN_CALLED`), hourly `QUEUE_DELAYED` alerts, `NT-03`, `IT-PUB-04`, `E2E-03` green; Bug Hunt: skipped re-queue subscription migration (`BUG-01`) & endpoint deduplication (`BUG-02`) green |
| **13** | Real-time queue updates | ⚪ Not Started | Depends on Phases 8, 9, 10 |
| **14** | Analytics and reporting | ⚪ Not Started | Depends on Phases 2, 8, 10 |
| **15** | Platform administration | ⚪ Not Started | Depends on Phases 1, 2, 14 |
| **16** | Security, concurrency and performance testing | ⚪ Not Started | Depends on Phases 1–15 |
| **17** | Production deployment | ⚪ Not Started | Depends on Phase 16 |

Legend: 🟢 Complete | 🔵 In Progress | 🟡 Pending Review | ⚪ Not Started | 🔴 Blocked

---

## Completed Pre-Phase 0 Deliverables

- [x] Root governance docs (`README.md`, `AGENTS.md`, `PROJECT_STATUS.md`, `DECISIONS.md`)
- [x] Product & SaaS requirements (`docs/01-product/*` — 7 files)
- [x] Business logic & engines (`docs/02-business-logic/*` — 8 files)
- [x] UX & design specs (`docs/03-ux-design/*` — 5 files)
- [x] System, multi-tenant, notification & job architecture (`docs/04-architecture/*` — 7 files)
- [x] PostgreSQL schema, ERD, RLS isolation & transactions (`docs/05-database/*` — 6 files)
- [x] API contracts, Auth, RBAC & error handling (`docs/06-api/*` — 7 files)
- [x] Security, privacy, tenant isolation & threat model (`docs/07-security/*` — 5 files)
- [x] Testing specifications (`docs/08-testing/*` — 7 files)
- [x] DevOps, SW setup, workers & monitoring (`docs/09-devops/*` — 7 files)
- [x] Implementation roadmap Phases 0–17 (`docs/10-project-management/*` — 5 files)

## Completed Phase 0 Deliverables

- [x] Workspace `.agent/skills/` (`feature-architecture`, `surgical-bug-hunt`) & `ADR-015` resolved
- [x] Next.js 15 App Router + strict TypeScript (`strict`, `noUncheckedIndexedAccess`, `noImplicitAny`) + Tailwind token CSS (`globals.css`, `tailwind.config.ts`)
- [x] Framer Motion, Lucide React, Zod, Pino (`src/lib/logger.ts`), AppError hierarchy (`src/lib/errors.ts`), Env validation (`src/lib/env.ts`)
- [x] ESLint client/server import boundaries (`eslint.config.mjs`) + Prettier formatting
- [x] Prisma initialization (`prisma/schema.prisma`, `src/server/db/prisma.ts`, `prisma validate` & `generate` verified)
- [x] Docker Postgres + `app_runtime` RLS role init SQL (`docker-compose.yml`, `docker/postgres/init-roles.sql`)
- [x] Foundational health endpoint (`GET /api/health`) & Vitest unit suite (`9/9` tests passing) & `next build` verified

## Completed Phase 1 Deliverables

- [x] Docker PostgreSQL 16 running on host port `5434` (`salonflow` + `salonflow_test`, separated `salonflow_admin` vs restricted `app_runtime`)
- [x] Complete 20-model Prisma schema (`prisma/schema.prisma`) with composite FKs, enums, snapshots, and indexes
- [x] Committed migrations (`20261112142905_init_multi_tenant_schema`, `20261112143500_rls_constraints_and_permissions`) applied to `salonflow` & `salonflow_test`
- [x] Force-enabled PostgreSQL RLS on 18 tenant-owned tables (with optional branch isolation on 5 branch-scoped tables)
- [x] `withTenantDb()` / `withBranchDb()` / `withSystemDb()` wrappers (`src/server/db/`) with `AsyncLocalStorage` nesting guard + ESLint restriction against raw Prisma access
- [x] Deterministic idempotent multi-tenant seed (`prisma/seed.ts`: Platform Admin, Org A with 2 branches, Org B with 1 branch)
- [x] Automated `TI-05` isolation, pooling, rollback, composite FK, DB health, and unit suites passing against real PostgreSQL as `app_runtime`

## Completed Phase 2 Deliverables

- [x] Auth.js v5 JWT session + Edge-compatible config (`src/server/auth/auth.config.ts`, `auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/types/next-auth.d.ts`)
- [x] Password verification & hashing (`src/server/auth/password.ts` supporting bcrypt cost 12 and legacy `scrypt:` seed hashes)
- [x] Brute-force protection (`src/server/auth/login-service.ts`: 5-attempt / 15-min lockout + `LOGIN_LOCKED` audit log) & sliding-window IP rate limiter (`src/server/security/rate-limiter.ts`, `ip.ts`)
- [x] Granular RBAC & tenant guards (`authorizeTenantAction()`, `requirePlatformAdmin()` in `src/server/auth/rbac.ts`), CSRF Origin/Host check (`src/server/security/csrf.ts`), and `POST /api/owner/account/password` (`sessionVersion` rotation)
- [x] Edge route guards (`src/middleware.ts`, `src/server/auth/middleware-guard.ts`) and token-styled mobile-first `/login` UI (`src/features/auth/`, `src/app/(auth)/login/page.tsx`)
- [x] Automated unit (`auth-security.test.ts`) and live PostgreSQL `TI-01`, `TI-02`, `TI-03`, `IT-RBAC-01`, lockout, suspension, and session revocation integration tests (`auth-rbac.test.ts`) passing

## Completed Phase 3 Deliverables

- [x] Safe-area insets, `@media print` `.no-print` rules (`src/app/globals.css`), and INR/duration formatters (`src/lib/formatters.ts`)
- [x] 9 semantic-token UI primitives (`src/components/ui/`: `Button`, `Input`, `Textarea`, `StatusBadge`, `ServiceCard`, `StatCard`, `ConfirmModal`, `BranchSwitcher`, `Toast`) honoring `>=48px` tap height, `>=16px` mobile inputs, and `useReducedMotion()`
- [x] Isolated adaptive shells (`PublicShell`, `DashboardShell` with desktop 240px sidebar + mobile bottom nav & RBAC filtering, `AdminShell`) and route-group layouts (`(public)`, `(owner)`, `(admin)`)
- [x] Component render & accessibility tests (`tests/unit/ui-primitives.test.tsx`, `formatters.test.ts`) passing in jsdom + React Testing Library

## Completed Phase 4 Deliverables

- [x] Atomic self-serve onboarding (`src/server/services/onboarding-service.ts`, `POST /api/auth/register-salon` rate-limited + honeypot, `GET|POST /api/auth/verify-email`, `/register`) initializing default `StaffRole`s, `RolePermission`s, `SalonSettings`, `Branch`, 7-day `BusinessHours`, and `AuditLog`
- [x] Branch management (`src/server/services/branch-service.ts`, `GET|POST /api/owner/branches`, `PATCH /api/owner/branches/[branchId]`, `settings-service.ts`, `/owner/branches`) inheriting active org services onto new branches
- [x] Staff invitations, branch assignment & immediate revocation (`src/server/services/staff-service.ts`, `/api/owner/staff/*`, `/api/auth/invites/[token]/accept`, `/invite/[token]`, `/owner/staff`) incrementing `sessionVersion` and disabling push subscriptions on revocation
- [x] Owner workspace dashboard (`/owner/dashboard`) and RBAC-wired `(owner)/layout.tsx`
- [x] Schema unit tests (`tests/unit/onboarding-schemas.test.ts`) and live PostgreSQL integration tests (`tests/integration/onboarding-branches-staff.test.ts`: `IT-ONB-01`, branch hours/inheritance, staff invite/revocation) passing

## Completed Phase 5 Deliverables

- [x] Bounded short-TTL public branch catalog cache (`src/server/cache/branch-catalog-cache.ts`, 20s TTL + LRU eviction + branch/org write-through invalidation)
- [x] Organization catalog & per-branch `BranchService` override domain service (`src/server/services/catalog-service.ts`), plus write-through invalidation in `branch-service.ts`
- [x] RBAC-protected REST endpoints (`GET|POST /api/owner/services`, `PATCH /api/owner/services/[serviceId]`, `PUT /api/owner/branches/[branchId]/services/[serviceId]`)
- [x] `/owner/services` UI (`src/features/services/components/services-manager.tsx`, `src/app/(owner)/owner/services/page.tsx`) with branch price/duration override controls and `ConfirmModal` soft-deactivation
- [x] Email verification login UX fix (`EmailNotVerifiedError` code `email_not_verified` in `auth.ts`, inline `"Resend Verification Link"` on `/login`, `POST /api/auth/resend-verification`, and primary verification CTA on `/register`)
- [x] Cache unit tests (`tests/unit/catalog-cache.test.ts`) and live PostgreSQL `IT-BRN-02` + resend verification integration tests (`tests/integration/services-catalog.test.ts`) passing

## Completed Phase 6 Deliverables

- [x] Indian 10-digit phone normalization/masking (`src/lib/phone.ts`), timezone + `dayResetTime` business date & operating hours evaluator (`src/lib/date.ts`), and earliest-free-station wait simulator (`src/lib/wait-time.ts`)
- [x] `BranchPublicService` & `validateBranchServiceSelection` (`src/server/services/branch-public-service.ts`) + `GET /api/public/salons/[salonSlug]/[branchSlug]`
- [x] Mobile-first customer intake UI (`/salon/[salonSlug]/[branchSlug]/page.tsx`, `src/features/public-intake/components/customer-intake-form.tsx`, `schemas.ts`) handling suspended/inactive, strict QR, closed/paused schedule, sticky checkout bar, honeypot, and `localStorage` active-token shortcut
- [x] Fixed NextAuth `Credentials.authorize()` rejecting `csrfToken`/`callbackUrl` via `.strict()` schema (`parseCredentialsInput` in `src/features/auth/schemas.ts`, wired in `src/server/auth/auth.ts`)
- [x] Unit (`tests/unit/phone-date-waittime.test.ts`: `UT-PHN-01..04`, `UT-DAT-01..03`, `UT-WT-01..04`) and live PostgreSQL integration (`tests/integration/public-intake-snapshot.test.ts`: branch availability states & `TI-04`) passing

## Completed Phase 7 Deliverables

- [x] `WaitTimeService` (`src/server/services/wait-time-service.ts`) computing live queue wait projections with bounded `[0.85, 1.35]` 30-day historical overrun calibration when `>= 20` completed tokens exist, reused cleanly by `BranchPublicService` and `TokenService`
- [x] `TokenService` (`src/server/services/token-service.ts`: `createPublicToken()`, `issueBranchToken()`, `resolvePublicBranchIdentity()`) implementing `pg_advisory_xact_lock`, idempotency key replay, `409 ACTIVE_TOKEN_EXISTS` zero-PII duplicate guard, branch `Customer` upsert, atomic `QueueCounter` `ON CONFLICT DO UPDATE`, 128-bit `publicId`, `TokenService` historical snapshots, `NEW_TOKEN_OWNER_ALERT` transactional outbox row, `TOKEN_CREATED` audit log, and non-blocking post-commit hook isolation
- [x] Rate-limited & honeypot-protected `POST /api/public/salons/[salonSlug]/[branchSlug]/tokens` (`201 Created` / `200 OK` on replay / `429` with rate-limit headers)
- [x] Unit (`tests/unit/token-generation.test.ts`) and live PostgreSQL concurrency & integration tests (`tests/integration/token-generation-concurrency.test.ts`: `IT-PUB-01`, `IT-PUB-02`, `IT-BRN-01`, `CT-01..04`, overrun blend) passing

## Completed Phase 8 Deliverables

- [x] Pure 7-status FIFO queue transition validator & timestamp helper (`src/lib/queue-state-machine.ts`: `validateTokenTransition()`, `buildTransitionTimestamps()`) + Zod schemas & DTOs (`src/features/queue/schemas.ts`, `src/features/queue/types.ts`)
- [x] Shared atomic helpers in `src/server/services/token-service.ts` (`resolveEffectiveBranchSettings()`, `allocateNextQueueTokenNumber()`) eliminating duplicated counter SQL and settings lookups
- [x] `QueueService` (`src/server/services/queue-service.ts`): `callNextToken()` (`FOR UPDATE SKIP LOCKED`), `transitionBranchToken()` (`FOR UPDATE` + customer push subscription revocation on closure + approaching threshold `NotificationEvent` outbox), `createWalkInToken()` (`source = "WALK_IN"`), `requeueSkippedToken()` (preserving immutable `SKIPPED` original + tail `QueueCounter` + `TOKEN_REQUEUED`), `getBranchQueueOverview()` (single-query conditional KPI aggregation + wait snapshot), and `getBranchTokenHistory()` (keyset cursor pagination, `limit <= 50`)
- [x] RBAC- & CSRF-protected API routes (`/api/owner/branches/[branchId]/queue` with `ETag`/`304`, `/queue/call-next`, `/tokens/walk-in`, `/tokens/[tokenId]/status`, `/tokens/[tokenId]/requeue`, `/history`)
- [x] Unit (`tests/unit/queue-state-machine.test.ts`: `UT-STM-01..05`) and live PostgreSQL integration & concurrency tests (`tests/integration/fifo-queue-engine.test.ts`: `IT-QUE-01`, `IT-QUE-02`, history cursor/search pagination, `CT-05`, `CT-06`) passing

## Completed Phase 9 Deliverables

- [x] Shared HTTP `jsonWithEtag()` helper (`src/lib/http.ts`) supporting deterministic `ETag` and `304 Not Modified` across owner queue and public token status endpoints
- [x] Sanitized token tracking service (`src/server/services/token-tracking-service.ts`: `resolvePublicTokenScope()`, `getPublicTokenTracking()`, `cancelPublicToken()`) masking mobile numbers (`******3210`), isolating vanity slugs (`TI-06`), linking re-queued skipped tokens, and delegating `WAITING`-only self-cancellation through `transitionBranchToken()` (`AuditLog`)
- [x] Rate-limited & CSRF-checked endpoints (`GET /api/public/tokens/[publicId]` with `60 req/min` + `ETag`/`304`, `POST /api/public/tokens/[publicId]/cancel` with `5 req/5m`)
- [x] Live customer ticket screen (`/salon/[salonSlug]/[branchSlug]/token/[publicId]/page.tsx` + `TokenTrackerView`) featuring confirmation copy, giant tabular `tokenNumber`, position/ahead/wait metrics, masked mobile, self-cancel `ConfirmModal`, `localStorage` active-ticket sync, re-queue banner link, and foreground `ETag` polling
- [x] Unit/jsdom (`tests/unit/token-tracking.test.tsx`) and live PostgreSQL integration tests (`tests/integration/customer-token-tracking.test.ts`: `IT-PUB-03`, `IT-PUB-05`, `TI-06`) passing

## Completed Phase 10 Deliverables

- [x] `QrService` (`src/server/services/qr-service.ts`) generating PNG buffers, SVG markup, and base64 data URLs with strict `?t={qrToken}` support and `BRANCH_QR_ROTATED` audit logging, exposed via `GET /api/owner/branches/[branchId]/qr` (`json|png|svg`) and `POST /api/owner/branches/[branchId]/qr/regenerate`
- [x] Upgraded `/owner/dashboard` with live branch KPI strip, accessible branch cards, and direct shortcuts to Live Queue, QR Studio, and History
- [x] Built `/owner/queue` (`LiveQueueConsole`) with RBAC-filtered actions (`Call Next`, Walk-In modal, `Start Service`, `Complete`, `Skip`, `No-Show`, `Cancel` `ConfirmModal`, `Re-queue to Tail`, Pause/Resume intake toggle, `ETag` 5s polling) and `/owner/history` (`BranchHistoryView` with status/date/search filters and keyset Load More)
- [x] Built `/owner/qr` (`QrStudio` with clean `@media print` `.no-print` standee poster, PNG/SVG downloads, copy URL, QR rotation) and `/owner/settings` (`OwnerSettingsView` for org defaults & password updates)
- [x] Unit/component (`tests/unit/phase10-dashboard-qr.test.tsx`) and live PostgreSQL integration tests (`tests/integration/qr-studio.test.ts`) passing

## Completed Phase 11 Deliverables

- [x] Installed `web-push` + `@types/web-push`, generated VAPID credentials in environment config, and implemented Service Worker (`public/sw.js` for `install`, `activate`, `push`, optional `/api/public/push/ack`, and `notificationclick` navigation)
- [x] Shared push validation & notification payload utilities (`src/lib/push-validation.ts`: SSRF/loopback/private-IP endpoint blocklist, VAPID `p256dh`/`auth` length verification, open-redirect URL sanitization, and safe message formatting) + schemas/types (`src/features/notifications/schemas.ts`, `src/features/notifications/types.ts`)
- [x] Transactional outbox worker & Web Push adapter (`src/server/notifications/web-push-adapter.ts`, `src/server/notifications/outbox-worker.ts`) using `FOR UPDATE SKIP LOCKED`, `[15s, 60s, 300s, 900s]` exponential backoff, `DEAD_LETTER` after 5 failed attempts, immediate `404`/`410` `PROVIDER_EXPIRED` deactivation, active-member & branch scoping (`OWNER`/`ADMIN` org-wide vs `STAFF` assigned-branch only), and automatic `runner.ts` nudge on token/queue mutations
- [x] RBAC- & CSRF-protected owner APIs (`/api/owner/push-subscriptions` `GET|POST|DELETE`, `/api/owner/push-subscriptions/test` rate-limited `POST`, `/api/owner/notifications` `GET`, `/api/owner/notifications/[id]/retry` `POST`) and `CRON_SECRET`-authenticated internal dispatcher (`POST /api/internal/jobs/process`)
- [x] Owner Push Preferences & Delivery Logs UI (`/owner/settings/notifications` via `OwnerNotificationsManager` + shortcut from `/owner/settings`)
- [x] Unit (`tests/unit/push-validation.test.ts`: `UT-PSH-01..02`) and live PostgreSQL integration tests (`tests/integration/notification-outbox.test.ts`: `NT-01`, `NT-02`, `NT-04`, `NT-05`, `NT-06`) passing

## Completed Phase 12 Deliverables

- [x] Built isomorphic browser Web Push client helpers (`src/lib/web-push-client.ts`: `isWebPushSupported()`, `isIosNonStandaloneBrowser()`, `requestAndSubscribeWebPush()`, `getActiveBrowserPushEndpoint()`) and refactored owner & customer flows to share a single tested client helper
- [x] Implemented post-token customer opt-in card (`src/features/notifications/components/customer-push-opt-in-card.tsx` on `/salon/[salonSlug]/[branchSlug]/token/[publicId]`) with zero upfront prompts, iOS Add-to-Home-Screen hint, graceful permission denial, and instant `Unsubscribe Alerts` toggle
- [x] Customer Push Subscription & Telemetry APIs (`POST /api/public/tokens/[publicId]/push-subscription` with `10 req/10m` rate limit, `DELETE .../push-subscription` for `CUSTOMER_OPT_OUT`, and `POST /api/public/push/ack` for Service Worker `DISPLAYED`/`CLICKED` `ACKNOWLEDGED` receipts)
- [x] Anti-flap milestone evaluator in `QueueService` (`src/server/services/queue-service.ts`) and `branch-service.ts` generating unique `token:{id}:APPROACHING_3`, `token:{id}:APPROACHING_1`, `token:{id}:CALLED`, and hourly `token:{id}:DELAYED:{bucketHour}` outbox rows with automatic `TOKEN_CLOSED` cleanup upon completion/cancellation
- [x] Unit/component (`tests/unit/token-tracking.test.tsx`: `E2E-03`, `tests/unit/push-validation.test.ts`: `QUEUE_DELAYED`) and live PostgreSQL integration tests (`tests/integration/customer-push-notifications.test.ts`: `NT-03`, `IT-PUB-04`) passing
