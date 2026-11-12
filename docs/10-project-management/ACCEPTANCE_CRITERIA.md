# Master Acceptance Criteria — SalonFlow SaaS

The platform is production-ready only when every gate below passes verification:

## 1. Multi-Tenant & Branch Isolation
- [ ] Two independent salon businesses operate on one deployment without cross-tenant data visibility.
- [ ] A single organization can operate multiple branches with independent FIFO queues, token counters (`A001`), QR URLs, business hours, and service overrides.
- [ ] Client-supplied `organizationId` spoofing is ignored/rejected; staff without branch access receive `403`.
- [ ] PostgreSQL RLS (`withTenantDb`) + composite FKs physically block cross-tenant reads/writes under non-superuser DB role.
- [ ] Platform Admins can manage/suspend tenants without unrestricted access to customer PII.

## 2. Customer Experience & Strict FIFO
- [ ] Scanning `/salon/{salon-slug}/{branch-slug}` opens mobile intake without login/app install.
- [ ] Inactive/unavailable services at that branch cannot be submitted.
- [ ] Concurrent submissions never generate duplicate daily branch tokens; strict FIFO `sequenceNumber` order is preserved.
- [ ] Simultaneous `Call Next` calls by two staff never call the same token twice.
- [ ] Manual walk-in entry (`source = WALK_IN`) uses the same atomic counter and FIFO queue and triggers live dashboard updates.
- [ ] Customer self-cancellation works ONLY while status is `WAITING` (branch-configurable), is blocked on `CALLED`/`IN_SERVICE`, and writes `AuditLog`.
- [ ] Re-queuing a `SKIPPED` customer preserves the original token record, allocates a new sequence at the back of `WAITING`, records `TOKEN_REQUEUED`, and preserves strict FIFO.
- [ ] Confirmation screen displays required messages, unguessable `publicId` URL, masked phone, and live SSE/polling status.

## 3. Web Push & Outbox Reliability
- [ ] Browser push prompts NEVER trigger automatically on landing page load.
- [ ] Customer permission denial or unsupported browser leaves live token tracking 100% functional.
- [ ] Customer threshold alerts (`3 ahead`, `1 ahead`, `called`) fire at most once per milestone without duplicate fluctuation spam.
- [ ] Owner/staff multi-device Web Push delivers new-customer alerts via transactional outbox; push failures never invalidate tokens.
- [ ] Expired `404`/`410` subscriptions automatically deactivate; dead-letter jobs are inspectable & retryable.

## 4. Performance, Security & Verification
- [ ] API latency meets SLOs (`p95 < 80ms` public reads, `p95 < 150ms` token writes); SSE broadcast triggers `<= 2` DB queries even at 40+ listeners.
- [ ] Strict TypeScript (`tsc --noEmit`), unit, integration, tenant-isolation, concurrency, notification, and Playwright E2E suites pass 100%.
