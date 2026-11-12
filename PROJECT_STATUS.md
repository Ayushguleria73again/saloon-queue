# PROJECT_STATUS.md — SalonFlow Implementation Tracker

**Last Updated**: 2026-11-12  
**Current Stage**: Phase 7 Complete — Ready for Phase 8  
**Overall Status**: 🟢 Phase 7 Verified & Complete — Ready for Phase 8 (FIFO Queue Management Engine)

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
| **8** | FIFO queue management engine | ⚪ Not Started | Depends on Phases 2, 7 |
| **9** | Customer token tracking | ⚪ Not Started | Depends on Phases 6, 7 |
| **10** | Owner dashboard | ⚪ Not Started | Depends on Phases 2, 3, 8 |
| **11** | Web Push infrastructure and owner notifications | ⚪ Not Started | Depends on Phases 1, 2, 7 |
| **12** | Customer push notifications | ⚪ Not Started | Depends on Phases 8, 9, 11 |
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
