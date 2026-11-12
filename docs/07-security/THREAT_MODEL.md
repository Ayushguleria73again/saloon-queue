# STRIDE Threat Model — SalonFlow SaaS

| Category | Threat Scenario | Risk | Controls |
| :--- | :--- | :---: | :--- |
| **Spoofing** | Attacker hijacks salon owner or staff account via credential stuffing | High | Auth.js v5, Argon2id/bcrypt, 5-attempt lockout (`15m`), IP rate limit, `sessionVersion` revocation |
| **Spoofing** | Fake push endpoint registered to trigger SSRF from server `web-push` | High | Strict HTTPS URL scheme validation + DNS/private-CIDR SSRF guard on `PushSubscription.endpoint` |
| **Tampering** | Client sends `organizationId: <victimOrg>` or altered service price in API request | High | Ignore client `organizationId`; server validates `BranchService` DB prices & enforces composite FKs + PostgreSQL RLS |
| **Tampering** | Concurrent QR scans or concurrent `Call Next` taps corrupt strict FIFO order | High | `pg_advisory_xact_lock`, atomic `QueueCounter` `ON CONFLICT`, `FOR UPDATE SKIP LOCKED`, `UNIQUE (branchId, businessDate, sequenceNumber)` |
| **Repudiation** | Disputed token skip/cancel or tenant suspension | Med | Immutable `AuditLog` with `actorType`, `actorId`, `organizationId`, `branchId`, `metadata`, `ipAddressHash` |
| **Info Disclosure** | Tenant A reads Tenant B's queues, customers, analytics, or push logs | Crit | `authorizeTenantAction`, `StaffBranchAccess`, composite FKs, PostgreSQL RLS (`SET LOCAL`), `404` on cross-tenant mismatch |
| **Info Disclosure** | Platform Admin views customer personal mobile numbers unnecessarily | Med | Platform Admin APIs aggregate metrics & mask/omit customer PII |
| **Info Disclosure** | Attacker enumerates `/token/1..N` or probes phone numbers via duplicate check | High | 128-bit cryptographic `publicId`, phone masked on public ticket, generic `409` conflict message |
| **DoS** | Flood of fake tokens or dead push endpoints degrades queue & worker throughput | High | Rate limiting, invisible honeypot, optional strict `?t=qrToken`, automatic `404`/`410` subscription deactivation, DLQ bounds |
| **Elevation** | Staff assigned to Branch A accesses Branch B or Org Billing/Settings | High | `RolePermission` + `StaffBranchAccess` checks enforced on every route & API handler |
