# Non-Functional Requirements (NFRs)

## 1. Performance & Scalability
- **`NFR-PERF-01` (API Latency)**:
  - Public branch landing read (`GET /api/public/salons/[salonSlug]/[branchSlug]`): `p50 < 20ms`, `p95 < 80ms`.
  - Public token tracking (`GET /api/public/tokens/[publicId]`): `p50 < 25ms`, `p95 < 80ms`.
  - Atomic token creation (`POST .../tokens`): `p50 < 45ms`, `p95 < 150ms`.
  - Owner FIFO actions (`Call Next`, transitions): `p50 < 35ms`, `p95 < 100ms`.
- **`NFR-PERF-02` (Scalability Under Concurrency)**:
  - Support bursts of `50+` concurrent token creations across branches without lock starvation or duplicate token numbers.
  - SSE broadcast uses single-query projection (`O(1)` DB work per branch update regardless of connected customer count `M`) to avoid thundering-herd DB overload.
- **`NFR-PERF-03` (Mobile First Web Vitals)**:
  - First Contentful Paint `< 1.5s` on 4G Indian mobile connections; minimal JS bundle on public customer routes (no dashboard charts/admin code shipped to customers).

---

## 2. Reliability & Availability
- **`NFR-REL-01` (Decoupled Outbox Delivery)**: Notification failures, VAPID endpoint errors (`410 Gone`), or offline devices NEVER fail or delay token generation.
- **`NFR-REL-02` (Idempotency)**: Both public token submissions (`idempotencyKey`) and push notification triggers (`NotificationEvent.idempotencyKey`) MUST be safely idempotent under retries.
- **`NFR-REL-03` (Graceful Degradation)**: Real-time updates fall back seamlessly from SSE to `ETag`-cached polling; customer ticket pages operate cleanly even if browser push is denied or unsupported.

---

## 3. Security & Privacy
- **`NFR-SEC-01`**: Zero cross-tenant leakage verified by automated multi-tenant isolation tests and PostgreSQL RLS defense-in-depth.
- **`NFR-SEC-02`**: Token lookup URLs use 128-bit cryptographic unguessable `publicId`s; sequential integer IDs are never exposed.
- **`NFR-SEC-03`**: Customer mobile numbers masked/omitted on public pages and redacted in Platform Admin standard views.

---

## 4. Compatibility & Maintainability
- **`NFR-COMP-01`**: Works across Android Chrome, Android Edge/Samsung Internet, Desktop Chrome/Firefox/Edge, and iOS Safari (`16.4+` PWA Home Screen notes for Web Push; full web functionality in standard iOS Safari).
- **`NFR-MAINT-01`**: Modular monolith with strict TypeScript (`strict: true`, `noUncheckedIndexedAccess: true`), Prisma migrations, and automated unit/integration/concurrency/E2E suites.

