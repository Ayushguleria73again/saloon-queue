# Changelog

---

## [0.18.0 — Phase 17: Production Deployment] - 2026-11-13

### Added
- **Multi-Stage Production Docker Packaging (`Dockerfile`)**:
  - Implemented secure 3-stage `node:20-alpine` build (`deps`, `builder`, `runner`) utilizing Next.js standalone server (`output: "standalone"`).
  - Enforced unprivileged container execution via non-root system user `nextjs:nodejs` (UID 1001) with strict file ownership.
  - Built-in container healthcheck querying `GET /api/health` with 5s timeout, 30s interval, and 3 retries.
- **Reverse Proxy Gateway Configuration (`docker/nginx/nginx.conf`)**:
  - Enforced unbuffered Server-Sent Events (SSE) streaming (`proxy_buffering off;`, `X-Accel-Buffering: no;`, `proxy_read_timeout 120s;`) for real-time queue synchronization.
  - Enforced Service Worker lifecycle freshness: served `/sw.js` with `Cache-Control: no-cache, no-store, must-revalidate` and `Service-Worker-Allowed: /`.
  - Configured TLS termination readiness, gzip static asset compression, and strict upstream reverse proxy routing to Next.js standalone container.
- **Production Compose Orchestration (`docker-compose.prod.yml`)**:
  - Orchestrated 3 isolated services: `db` (Postgres 16 Alpine), `app` (standalone Next.js), and `proxy` (Nginx reverse proxy on port 80).
  - Enforced strict database role separation: `DATABASE_URL` runtime and worker queries execute exclusively under unprivileged `app_runtime` (`NOSUPERUSER NOBYPASSRLS`), ensuring PostgreSQL Row-Level Security (`SET LOCAL app.current_organization_id`) cannot be bypassed, while schema migrations run via `DIRECT_URL` as `salonflow_admin`.
- **Automated Backup & Restore Drill Scripts**:
  - Built `scripts/backup.sh` generating timestamped, custom-format compressed dumps (`pg_dump -Fc --no-owner --no-acl`) with automatic 7-day retention pruning.
  - Built `scripts/restore.sh` performing verified database restore drills (`pg_restore --clean --if-exists`), re-granting `app_runtime` permissions and auditing `relrowsecurity` on all tenant tables.
  - Built `scripts/deploy.sh` running pre-flight environment checks, database migrations (`prisma migrate deploy`), permission verification, Platform Admin seeding, and RLS security auditing.
- **Platform Admin CLI Provisioning Tool (`scripts/seed-platform-admin.ts`)**:
  - Created idempotent CLI script supporting configurable `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `ADMIN_NAME` with bcrypt hashing and active status enforcement.
  - Added npm scripts to `package.json`: `npm run seed:admin`, `npm run db:backup`, `npm run db:restore`, `npm run deploy`.
- **Production Deployment Smoke Suite**:
  - Authored `tests/integration/production-deployment-smoke.test.ts` (7/7 tests passing) verifying Row-Level Security on all tenant tables, `app_runtime` unprivileged boundaries, `nginx.conf` header compliance, `Dockerfile` multi-stage security, `docker-compose.prod.yml` service wiring, and backup/restore script integrity.

---

## [0.17.0 — Phase 16: Security, Concurrency and Performance Testing] - 2026-11-13

### Added
- **Security Headers Hardening**:
  - Configured comprehensive security headers in `next.config.ts` matching `/(.*)`: `Strict-Transport-Security` (`max-age=31536000; includeSubDomains`), `Content-Security-Policy` (`default-src 'self'`, `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
  - Added security headers injection in Next.js middleware (`src/middleware.ts`) for all evaluated routes.
- **CSRF Origin/Host Defense**:
  - Enforced `assertSameOriginRequest` across all state-mutating administrative routes (`PATCH /api/admin/tenants/[organizationId]/status`, `POST /api/admin/jobs/[eventId]/retry`).
  - Verified cross-origin rejection (`403 FORBIDDEN: Cross-origin state mutation blocked`) against spoofed or mismatched `Origin` and `Host` headers.
- **Edge Rate Limiting Enforcement**:
  - Validated LRU sliding-window capacity eviction and standard response headers (`Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`) across all 7 production rate-limiting rules (`publicTokenIp`, `publicTokenMobile`, `publicPushSubscribe`, `publicTokenRead`, `publicTokenCancel`, `authRegisterSalon`, `ownerPushTest`).
- **Honeypot Bot Trap & SSRF Protection**:
  - Verified honeypot bot trap rejection on salon onboarding (`website` field) and public intake forms (`website` field).
  - Verified strict SSRF blocking in `isValidPushEndpoint` preventing loopback (`127.0.0.1`), link-local metadata (`169.254.169.254`), private RFC 1918 subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), and non-HTTPS URLs while permitting valid public push services.
- **Latency Benchmarking (`PT-01` – `PT-03`)**:
  - Benchmarked 50 concurrent branch reads achieving `p95 = 22.1ms` (target `< 80ms`).
  - Benchmarked 20 burst token creation writes with advisory locks achieving `p95 = 130.9ms` (target `< 150ms`).
  - Verified single-pass SSE fan-out query budget (`PT-02` <= 2 queries for 40 listeners) and ETag 304 polling efficiency (`PT-03`).
- **Verification Suite**:
  - Added comprehensive test suite `tests/integration/security-concurrency-performance.test.ts` (7 tests covering `PT-01`, rate limiting, headers, CSRF, honeypot, SSRF).
  - Passed complete test gate: 95/95 unit tests green, 66/66 integration tests green across 17 suites, 0 TS errors, 0 ESLint warnings, and Next.js production build passing cleanly.

---

## [0.16.0 — Phase 15: Platform Administration] - 2026-11-13

### Added
- **Platform Administration Domain Service (`PlatformAdminService`)**: Built `src/server/services/platform-admin-service.ts` leveraging `withSystemDb` and non-PII projections to provide global SaaS operator oversight:
  - System-wide operational overview (`getPlatformOverview`) aggregating organizations (active, suspended), total branches, today's platform token throughput, and outbox job states (`PENDING`, `PROCESSING`, `FAILED`, `DEAD_LETTER`).
  - Tenant directory with cursor/offset pagination and status filters (`listTenants`), returning organization slugs, owner contact, branch count, active tokens, and current status.
  - Tenant status toggle (`updateTenantStatus`) supporting `ACTIVE` <-> `SUSPENDED` with mandatory operator reason, audit logging (`TENANT_STATUS_CHANGED`), and immediate user session invalidation via `sessionVersion` increment.
  - Platform-wide outbox job inspection (`listPlatformJobs`) with status filters and safe pagination, projecting only non-PII operational payloads.
  - Dead-letter outbox retry mechanism (`retryPlatformJob`) resetting attempt counts and error messages with immediate worker dispatch nudges.
  - Comprehensive platform health diagnostics (`getPlatformHealthDetails`) reporting live PostgreSQL connection pool metrics, database uptime, migrations count, and active background worker status.
- **Strict Operator RBAC (`requirePlatformAdmin`)**: Built centralized admin guard enforcing `user.isPlatformAdmin === true` and active account status, rejecting unauthorized users with `403 FORBIDDEN` (`ADMIN_FORBIDDEN`).
- **Zero Customer PII Projection (`IT-ADM-02`)**: Ensured all platform administration queries, DTOs, and UIs strictly exclude customer names, mobile numbers, notes, or PII.
- **Immediate Tenant Invalidation on Suspension (`IT-ADM-01`)**: Enforced immediate blocking of public intake (`403 TENANT_SUSPENDED`) and owner/staff dashboard operations across all branches upon suspension, while reactivating restores normal operation.
- **REST Route Handlers**:
  - `GET /api/admin/overview`: System operational overview.
  - `GET /api/admin/tenants`: Tenant directory with search and status filtering.
  - `PATCH /api/admin/tenants/[organizationId]/status`: Tenant status toggle with reason and audit log.
  - `GET /api/admin/jobs`: Background job inspection.
  - `POST /api/admin/jobs/[eventId]/retry`: Dead-letter job retry.
  - `GET /api/admin/health/details`: System telemetry and database metrics.
- **Operator Admin Console UI**: Built `/admin`, `/admin/tenants`, and `/admin/jobs` wrapped inside `AdminShell` (`AdminOverview`, `TenantsDirectory` with modal confirmation, and `BackgroundJobsView` with retry triggers) styled cleanly with semantic design tokens.
- **Verification Suite**: Created unit test suite (`tests/unit/admin-schemas.test.ts`) and integration test suite (`tests/integration/platform-administration.test.ts`) verifying `IT-ADM-01`, `IT-ADM-02`, dead-letter retry, non-admin RBAC blocks, and system diagnostics with 100% test pass rate.

---

## [0.15.0 — Phase 14: Analytics & Reporting] - 2026-11-13

### Added
- **Analytics Domain Service (`AnalyticsService`)**: Built `src/server/services/analytics-service.ts` leveraging PostgreSQL composite indexed SQL aggregations (`COUNT(*) FILTER`, `AVG(EXTRACT(EPOCH FROM ...))`, `DATE_TRUNC`) under tenant RLS (`withTenantDb`), computing operational KPIs, time-bucketed trend series (`day`, `week`, `month`), top requested services, and cross-branch comparison metrics in single queries with zero customer PII leakage.
- **Strict Staff RBAC & Branch Scoping**: Gated analytics under `ANALYTICS_VIEW` permission, intersecting requested branch filters against verified `StaffBranchAccess` for staff members (`BRANCH_ACCESS_DENIED`) and throwing `NotFoundError` for cross-tenant branch queries.
- **REST API Route**: Built `GET /api/owner/analytics` (`src/app/api/owner/analytics/route.ts`) validating queries (`range`, `branchId`, `from`, `to`, `granularity`) via Zod (`analyticsQuerySchema`).
- **Owner Analytics UI**: Built `/owner/analytics` (`src/app/(owner)/owner/analytics/page.tsx` & `src/features/analytics/components/analytics-dashboard.tsx`) featuring date range presets (`Today`, `7 Days`, `30 Days`, `90 Days`, `Custom`), branch selector, 6 KPI stat cards, visual responsive volume & completion trend chart, ranked top services cards with revenue progress bars, and side-by-side multi-branch performance table styled purely with semantic Tailwind tokens.
- **Verification Suite**: Created unit tests (`tests/unit/analytics-schemas.test.ts`) and live PostgreSQL integration tests (`tests/integration/analytics-reporting.test.ts`: `IT-ANA-01`, cross-tenant isolation, Staff RBAC & branch assignment).

---

## [0.14.0 — Phase 13: Real-Time Queue Updates] - 2026-11-13

### Added
- **RealtimeHub & Burst Coalescing**: Built central `RealtimeHub` singleton (`src/server/realtime/hub.ts`) managing tenant/branch scoped subscribers (`branch:{organizationId}:{branchId}`), supporting in-memory event fan-out with 50ms burst coalescing + PostgreSQL `LISTEN/NOTIFY` over `DIRECT_URL`.
- **Single-Pass Projection Fan-Out (`PT-02`)**: Implemented single-pass snapshot projection that evaluates station simulation and personalizes non-PII token updates across 40+ concurrent SSE customer listeners with `<= 2` database queries per queue mutation without N+1 query amplification.
- **Server-Sent Events Route Handlers**: Built `GET /api/owner/branches/[branchId]/queue/events` and `GET /api/public/tokens/[publicId]/events` streaming `text/event-stream` with 25s keepalive `: ping\n\n`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`, and terminal auto-close on `COMPLETED`/`CANCELLED`/`NO_SHOW`.
- **Resilient Client Hook (`useRealtimeStream`)**: Built `src/features/queue/hooks/use-realtime-stream.ts` managing native `EventSource`, `visibilitychange` + `online` resynchronization via `If-None-Match` (`ETag`), and graceful fallback to 5s polling upon 3 consecutive network failures.
- **UI Integration**: Wired `useRealtimeStream` into `/owner/queue` (`LiveQueueConsole`) and `/salon/[salonSlug]/[branchSlug]/token/[publicId]` (`TokenTrackerView`) for instant sub-second live queue updates.
- **Verification Suite**: Added comprehensive integration test suite `tests/integration/realtime-sse-stream.test.ts` covering `PT-02` (40 concurrent listeners, query budget <= 2), `IT-RT-01` (status advance, delivery, terminal close), `IT-RT-02` (skipped re-queue link broadcast), `IT-RT-03` (50ms rapid mutation burst coalescing), `PT-03` (`ETag` `304` zero body overhead), and `IT-RT-04` (headers, keepalive, and clean abort).

---

## [0.13.1 — Bug Hunt: Skipped Re-queue Push Migration & Endpoint Deduplication] - 2026-11-13

### Fixed
- **Skipped Re-queue Push Subscription Migration**: Resolved issue in `QueueService.requeueSkippedToken()` where customers who subscribed to turn alerts on an original token stopped receiving notifications when their skipped token was placed back into the tail of the queue. Active push subscriptions (previously marked `TOKEN_CLOSED` during `SKIP`) are now atomically cloned and reactivated for the new token row within the same ACID transaction, ensuring `TOKEN_REQUEUED`, approaching milestones (`CUSTOMER_APPROACHING_3`, `CUSTOMER_APPROACHING_1`), and `TOKEN_CALLED` seamlessly reach the customer's device, and `pushAlertsEnabled` renders `true` on the new tracking view.
- **Device Endpoint Deduplication in Outbox Worker**: Fixed `resolveEligibleSubscriptions()` in `src/server/notifications/outbox-worker.ts` to deduplicate resolved subscriptions by physical device `endpoint` using a `Set<string>`, preventing duplicate parallel push dispatches to physical devices when multiple active accounts or scopes share the same browser push subscription.
- **Regression Verification**: Added `tests/integration/requeue-push-migration.test.ts` (`BUG-01`, `BUG-02`) verifying end-to-end subscription migration, outbox delivery of `TOKEN_REQUEUED` and `TOKEN_CALLED`, and physical device push deduplication under PostgreSQL RLS.

---

## [0.13.0 — Phase 12: Customer Push Notifications] - 2026-11-13

### Added
- Built browser Web Push client helpers (`src/lib/web-push-client.ts`) and refactored owner and customer push flows to share tested browser permission/registration logic.
- Implemented `CustomerPushOptInCard` (`src/features/notifications/components/customer-push-opt-in-card.tsx`) on `/salon/[salonSlug]/[branchSlug]/token/[publicId]` with zero auto-prompting, iOS Safari Add-to-Home-Screen hint, graceful permission denial, and instant `Unsubscribe Alerts` toggle.
- Built customer endpoints: `POST|DELETE /api/public/tokens/[publicId]/push-subscription` (with `10 req/10m` rate limit and `CUSTOMER_OPT_OUT`), and `POST /api/public/push/ack` for Service Worker `DISPLAYED` / `CLICKED` `ACKNOWLEDGED` telemetry.
- Built milestone notification evaluator in `QueueService` and `branch-service.ts` emitting idempotent `CUSTOMER_APPROACHING_3`, `CUSTOMER_APPROACHING_1`, `TOKEN_CALLED`, and hourly `QUEUE_DELAYED` outbox events with automatic `TOKEN_CLOSED` subscription revocation on completion or cancellation.
- Added unit/component tests (`tests/unit/token-tracking.test.tsx`: `E2E-03`, `tests/unit/push-validation.test.ts`: `QUEUE_DELAYED`) and live PostgreSQL integration tests (`tests/integration/customer-push-notifications.test.ts`: `NT-03`, `IT-PUB-04`).

---

## [0.12.0 — Phase 11: Web Push Infrastructure & Owner Notifications] - 2026-11-12

### Added
- Installed `web-push` + `@types/web-push`, configured VAPID keys, and implemented Service Worker (`public/sw.js`) for Web Push notification rendering, click routing, and optional `/api/public/push/ack`.
- Built isomorphic push endpoint/key SSRF validation, open-redirect URL sanitization, and payload formatters (`src/lib/push-validation.ts`), plus notification Zod schemas and DTOs (`src/features/notifications/schemas.ts`, `src/features/notifications/types.ts`).
- Built `VapidWebPushTransport` (`src/server/notifications/web-push-adapter.ts`), transactional `NotificationOutboxWorker` (`src/server/notifications/outbox-worker.ts` with `FOR UPDATE SKIP LOCKED`, `[15s, 60s, 300s, 900s]` retries, `DEAD_LETTER` after 5 failures, `404`/`410` device revocation, and active-member/branch scoping), and background runner nudges (`src/server/jobs/runner.ts`) hooked into `token-service.ts` and `queue-service.ts`.
- Built `owner-notification-service.ts`, owner endpoints (`/api/owner/push-subscriptions`, `/api/owner/push-subscriptions/test`, `/api/owner/notifications`, `/api/owner/notifications/[id]/retry`), `CRON_SECRET` worker trigger (`POST /api/internal/jobs/process`), and `/owner/settings/notifications` UI (`OwnerNotificationsManager`).
- Added unit tests (`tests/unit/push-validation.test.ts`: `UT-PSH-01..02`) and live PostgreSQL integration tests (`tests/integration/notification-outbox.test.ts`: `NT-01`, `NT-02`, `NT-04`, `NT-05`, `NT-06`).

---

## [0.11.0 — Phase 10: Owner Dashboard, Live Queue Console & QR Studio] - 2026-11-12

### Added
- Installed `qrcode` and built `QrService` (`src/server/services/qr-service.ts`), `GET /api/owner/branches/[branchId]/qr?format=json|png|svg`, and `POST /api/owner/branches/[branchId]/qr/regenerate` (`BRANCH_QR_ROTATED` audit).
- Upgraded `/owner/dashboard` (`src/app/(owner)/owner/dashboard/page.tsx`) with live branch KPIs and quick links to Live Queue, QR Studio, and History.
- Built `/owner/queue` (`src/features/queue/components/live-queue-console.tsx`) with 7 live KPIs, `Call Next`, `+ Add Walk-In` modal, status action controls gated by `RolePermission`, `Re-queue to Tail` on skipped tokens, intake pause/resume toggle, and foreground `ETag` polling.
- Built `/owner/history` (`src/features/queue/components/branch-history-view.tsx`) with keyset-paginated date/status/search filtering.
- Built `/owner/qr` (`src/features/qr/components/qr-studio.tsx`) with `@media print`-isolated standee poster, PNG/SVG downloads, copy URL, and `ConfirmModal` QR rotation, plus `/owner/settings` (`src/features/settings/components/owner-settings-view.tsx`).
- Added unit/component (`tests/unit/phase10-dashboard-qr.test.tsx`) and live PostgreSQL integration tests (`tests/integration/qr-studio.test.ts`).

---

## [0.10.0 — Phase 9: Customer Token Tracking] - 2026-11-12

### Added
- Built sanitized customer ticket service (`src/server/services/token-tracking-service.ts`: `resolvePublicTokenScope()`, `getPublicTokenTracking()`, `cancelPublicToken()`) with mobile masking (`******3210`), cross-tenant vanity URL protection (`TI-06`), re-queue destination links, and `WAITING`-only audited self-cancellation.
- Extracted shared `jsonWithEtag()` (`src/lib/http.ts`) and reused it in `GET /api/owner/branches/[branchId]/queue` and `GET /api/public/tokens/[publicId]`.
- Added rate-limited public ticket endpoints (`GET /api/public/tokens/[publicId]` with `ETag`/`304`, `POST /api/public/tokens/[publicId]/cancel`).
- Built `/salon/[salonSlug]/[branchSlug]/token/[publicId]` (`TokenTrackerView`) displaying confirmation copy, giant monospace token badge, queue position/wait metrics, masked customer details, re-queue link banner, `ConfirmModal` cancellation, `localStorage` sync, and visibility-aware `ETag` polling.
- Added unit/jsdom (`tests/unit/token-tracking.test.tsx`) and live PostgreSQL integration tests (`tests/integration/customer-token-tracking.test.ts`: `IT-PUB-03`, `IT-PUB-05`, `TI-06`).

---

## [0.9.0 — Phase 8: FIFO Queue Management Engine] - 2026-11-12

### Added
- Built pure 7-status FIFO queue transition engine (`src/lib/queue-state-machine.ts`: `validateTokenTransition()`, `buildTransitionTimestamps()`) and transport schemas/types (`src/features/queue/schemas.ts`, `src/features/queue/types.ts`).
- Built `QueueService` (`src/server/services/queue-service.ts`) implementing atomic `callNextToken()` (`FOR UPDATE SKIP LOCKED`), `transitionBranchToken()` (`FOR UPDATE` row lock + terminal `PushSubscription` deactivation + idempotent `CUSTOMER_APPROACHING_1`/`CUSTOMER_APPROACHING_3` outbox rows), `createWalkInToken()` (`source = "WALK_IN"`), `requeueSkippedToken()` (preserving immutable `SKIPPED` original while allocating tail `QueueCounter` token + `TOKEN_REQUEUED`), `getBranchQueueOverview()` (single-SQL conditional KPIs + active groups), and `getBranchTokenHistory()` (keyset cursor pagination, `limit <= 50`).
- Extracted `resolveEffectiveBranchSettings()` and `allocateNextQueueTokenNumber()` in `src/server/services/token-service.ts` for shared reuse between `TokenService` and `QueueService`.
- Added RBAC/CSRF-protected API routes: `GET /api/owner/branches/[branchId]/queue` (`ETag`/`304`), `POST /api/owner/branches/[branchId]/queue/call-next`, `POST /api/owner/branches/[branchId]/tokens/walk-in`, `PATCH /api/owner/branches/[branchId]/tokens/[tokenId]/status`, `POST /api/owner/branches/[branchId]/tokens/[tokenId]/requeue`, and `GET /api/owner/branches/[branchId]/history`.
- Added unit tests (`tests/unit/queue-state-machine.test.ts`: `UT-STM-01..05`) and live PostgreSQL integration & concurrency suite (`tests/integration/fifo-queue-engine.test.ts`: `IT-QUE-01`, `IT-QUE-02`, cursor pagination/search, `CT-05`, `CT-06`).

---

## [0.8.1 — Surgical Bug Hunt (Phase 6 & Phase 7 Intake / Branch Settings)] - 2026-11-12

### Fixed
- **CustomerIntakeForm `404` Error Handling & Non-HTTPS UUID Generation (`src/features/public-intake/components/customer-intake-form.tsx`)**: Removed the stale Phase 6 `404` stub message so missing/stale branch responses parse and display real API error envelopes (`json.error?.message`), guarded JSON body parsing against malformed responses, and replaced the static hardcoded fallback UUID with RFC 4122 v4 generation via `crypto.getRandomValues()` when `crypto.randomUUID` is unavailable (e.g., mobile devices testing over plain HTTP LAN origins).
- **Secondary Branch Settings Inheritance (`src/server/services/branch-service.ts`)**: Copied `dayResetTime`, `notifyDelayThresholdMinutes`, and `longQueueAlertThreshold` from organization default `SalonSettings` when creating new branches so custom reset schedules and alert thresholds propagate consistently.

### Added
- Regression tests in `tests/unit/customer-intake-bug-hunt.test.tsx` (`BUG-01`, `BUG-02`) and `tests/integration/token-generation-concurrency.test.ts` (`BUG-03`).

---

## [0.8.0 — Phase 7: Token Generation Engine & Concurrency] - 2026-11-12

### Added
- Built `WaitTimeService` (`src/server/services/wait-time-service.ts`) combining earliest-free-station wait simulation with clamped `[0.85, 1.35]` 30-day historical overrun calibration when `>= 20` completed branch tokens exist, and reused it in `BranchPublicService`.
- Built `TokenService` (`src/server/services/token-service.ts`: `createPublicToken()`, `issueBranchToken()`, `resolvePublicBranchIdentity()`) with `pg_advisory_xact_lock`, idempotency key replay, `409 ACTIVE_TOKEN_EXISTS` zero-PII duplicate active guard, `Customer` upsert, atomic daily `QueueCounter` `ON CONFLICT DO UPDATE`, 128-bit `publicId`, `TokenService` price/duration snapshots, `NEW_TOKEN_OWNER_ALERT` transactional outbox event, `TOKEN_CREATED` audit log, and non-blocking post-commit hook isolation.
- Added `POST /api/public/salons/[salonSlug]/[branchSlug]/tokens` (`src/app/api/public/salons/[salonSlug]/[branchSlug]/tokens/route.ts`) enforcing honeypot rejection, per-branch IP (`20/10m`) and mobile (`3/15m`) sliding-window rate limits, returning `201 Created` (`200 OK` on idempotent replay) with `{ token, redirectUrl }`.
- Added unit tests (`tests/unit/token-generation.test.ts`) and live PostgreSQL integration & concurrency suite (`tests/integration/token-generation-concurrency.test.ts`: `IT-PUB-01`, `IT-PUB-02`, `IT-BRN-01`, `CT-01..04`, 30-day overrun calibration).

---

## [0.7.0 — Phase 6: Public QR Customer Interface & Credentials Login Fix] - 2026-11-12

### Added
- Implemented `BranchPublicService` & `validateBranchServiceSelection()` (`src/server/services/branch-public-service.ts`), `GET /api/public/salons/[salonSlug]/[branchSlug]`, and `/salon/[salonSlug]/[branchSlug]` mobile-first customer intake UI (`CustomerIntakeForm`, sticky bottom bar, honeypot, `localStorage` active-token shortcut, suspended/closed/QR-invalid states).
- Added pure domain helpers: Indian 10-digit mobile normalization/masking (`src/lib/phone.ts`), timezone + `dayResetTime` + operating-hours evaluation (`src/lib/date.ts`), and `O(N*K)` earliest-free-station wait-time simulator (`src/lib/wait-time.ts`).
- Added unit tests (`tests/unit/phone-date-waittime.test.ts` covering `UT-PHN-01..04`, `UT-DAT-01..03`, `UT-WT-01..04`) and live PostgreSQL integration tests (`tests/integration/public-intake-snapshot.test.ts` covering branch states and `TI-04`).

### Fixed
- **Credentials `authorize()` Form Field Rejection**: Added `parseCredentialsInput()` (`src/features/auth/schemas.ts`) used by `src/server/auth/auth.ts` so Auth.js's extra form-body fields (`csrfToken`, `callbackUrl`) no longer trip `loginSchema.strict()` during browser sign-in (`tests/unit/auth-security.test.ts`).

---

## [0.6.0 — Phase 5: Services Management & Verification Login UX Fix] - 2026-11-12

### Added
- Built organization `Service` catalog and per-branch `BranchService` override service (`src/server/services/catalog-service.ts`), Zod schemas (`src/features/services/schemas.ts`), and RBAC-protected API routes (`/api/owner/services`, `/api/owner/services/[serviceId]`, `/api/owner/branches/[branchId]/services/[serviceId]`).
- Built bounded LRU short-TTL (`20s`) public catalog cache (`src/server/cache/branch-catalog-cache.ts`) with immediate write-through invalidation from both `CatalogService` and `BranchService`.
- Built `/owner/services` UI (`src/features/services/components/services-manager.tsx`, `src/app/(owner)/owner/services/page.tsx`) supporting branch price/duration overrides, availability toggles, and `ConfirmModal` soft-deactivation without mutating historical `TokenService` snapshots.
- Added cache/schema unit tests (`tests/unit/catalog-cache.test.ts`) and live PostgreSQL `IT-BRN-02` integration tests (`tests/integration/services-catalog.test.ts`).

### Fixed
- **Unverified Signup Sign-In UX**: Added `EmailNotVerifiedError` (`code: "email_not_verified"`) in `src/server/auth/auth.ts` (thrown only after password match), added `POST /api/auth/resend-verification` (`resendVerificationEmail` in `onboarding-service.ts`), surfaced clear `"Please verify your email address before signing in."` + inline `"Resend Verification Link"` CTA in `LoginForm`, and promoted the dev verification link to the primary button on `/register`.

---

## [0.5.0 — Phase 4: Salon Onboarding & Branch Management] - 2026-11-12

### Added
- Built atomic salon registration & email verification (`src/server/services/onboarding-service.ts`, `src/app/api/auth/register-salon/route.ts`, `verify-email/route.ts`, `/register` UI) with `5 req / 1 hr` per-IP rate limiting, honeypot guard, default `StaffRole`s + permissions, initial `Branch` + 7 `BusinessHours`, `SalonSettings`, and `AuditLog`.
- Built multi-branch management & org settings (`src/server/services/branch-service.ts`, `settings-service.ts`, `/api/owner/branches/*`, `/api/owner/settings`, `/owner/branches` UI) with active catalog `BranchService` inheritance and 7-day hours/rules editor.
- Built 48-hour SHA-256 hashed staff invitations, branch-scoped `StaffBranchAccess` management, `/invite/[token]` acceptance flow, and immediate `STAFF_REVOKED` session/push revocation (`src/server/services/staff-service.ts`, `/api/owner/staff/*`, `/api/auth/invites/[token]/accept`, `/owner/staff` UI).
- Implemented `/owner/dashboard` onboarding checklist + branch summary and wired `(owner)/layout.tsx` to real `authorizeTenantAction()` tenant context (`organizationName` + `permissions`).
- Added unit (`tests/unit/onboarding-schemas.test.ts`) and live PostgreSQL integration tests (`tests/integration/onboarding-branches-staff.test.ts`: `IT-ONB-01`, branch inheritance/isolation, staff invite/revocation).

---

## [0.4.1 — Surgical Bug Hunt (Phase 2 & Phase 3)] - 2026-11-12

### Fixed
- **Auth Rate-Limit NextAuth Redirect Compatibility (`src/app/api/auth/[...nextauth]/route.ts`, `src/features/auth/components/login-form.tsx`, `src/server/security/ip.ts`)**: Added `url: "/login?error=RateLimited"` to `429` credentials callback responses when `X-Auth-Return-Redirect: 1` is sent so `next-auth/react` `signIn()` parses the response instead of throwing `Invalid URL`, resolved `hashIpAddress` fallback without requiring unrelated env vars, and handled `?error=RateLimited` in `LoginForm`.
- **Platform Admin Routing (`src/server/auth/middleware-guard.ts`, `src/features/auth/components/login-form.tsx`)**: Routed pure Platform Admins (`isPlatformAdmin && !activeOrganizationId`) cleanly to `/admin` both on post-login resolution and when visiting `/owner/*`.
- **Mobile Workspace Access (`src/components/layout/dashboard-shell.tsx`, `admin-shell.tsx`)**: Added an accessible mobile navigation drawer in `DashboardShell` exposing secondary routes (`Branches`, `Staff & Roles`, `History`, `Analytics`) and `Sign Out` at `< 768px`, plus a mobile `Sign Out` button in `AdminShell`.
- **UI Primitive Polish (`src/components/ui/button.tsx`, `branch-switcher.tsx`, `confirm-modal.tsx`, `input.tsx`)**: Enforced `min-h-12` (`48px`) mobile tap target on `Button` `size="sm"`, added `ChevronDown` and controlled value fallback to `BranchSwitcher`, added initial dialog focus on `ConfirmModal` open, and styled disabled `<Input>` wrappers clearly.

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
