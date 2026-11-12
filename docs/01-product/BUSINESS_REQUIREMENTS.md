# Business Requirements Document (BRD)

## 1. Business Objectives

1. **Multi-Tenant SaaS Scalability**: Onboard independent salons and multi-branch salon chains onto a single modular monolithic deployment with zero per-tenant infrastructure provisioning.
2. **Zero Messaging Cost Overhead**: Utilize Web Push API + Service Workers so neither salon owners nor SaaS operators incur per-SMS or WhatsApp BSP charges for high-frequency queue alerts.
3. **Fair & Predictable Strict FIFO Queueing**: Eliminate queue disputes by serving tokens strictly in order of valid atomic creation (`sequenceNumber ASC`) with no manual VIP jumping in v1.
4. **Complete Operational Auditability**: Track every token creation, status transition, permission change, and notification attempt for operational transparency.

---

## 2. Core Business Rules

- **`BR-01` (Tenant & Branch Scoping)**: Every business belongs to an `Organization`; every physical location is a `Branch`. Customers, queues, daily token sequences, QR URLs, business hours, notifications, and service availability operate independently per `Branch`.
- **`BR-02` (Business Date & Timezone)**: Each `Branch` operates in its own IANA `timezone` (default `Asia/Kolkata`) with `SalonSettings.dayResetTime` (default `00:00`). Token sequences (`A001`, `A002`, ...) reset automatically at each branch's business day rollover.
- **`BR-03` (Service Snapshot Integrity)**: `TokenService` copies service name, effective branch price (`priceInPaise`), and effective duration at booking time so later price edits or service deactivations never alter historical tokens or revenue analytics.
- **`BR-04` (Strict FIFO)**: Active `WAITING` tokens are always called in ascending `sequenceNumber` order per `(branchId, businessDate)`. `CANCELLED`, `SKIPPED`, and `NO_SHOW` tokens do not block subsequent `WAITING` tokens. Re-queued skipped tokens receive a brand-new `sequenceNumber` at the back of `WAITING` while keeping original token history intact.
- **`BR-05` (Duplicate Active Token Guard)**: By default (`allowDuplicateActiveTokens = false`), one normalized 10-digit Indian mobile number may hold at most one active token (`WAITING`, `CALLED`, `IN_SERVICE`) per `Branch` at a time.
- **`BR-06` (Decoupled Push Reliability)**: Token generation succeeds deterministically even if every push provider request fails or no devices are subscribed. Outbox `NotificationEvent` rows drive asynchronous delivery and retries.
- **`BR-07` (Anti-Flap Customer Alerts)**: Customer threshold notifications (`3 ahead`, `1 ahead`, `called`) fire **at most once** per `(tokenId, eventType)` via unique idempotency keys, even if branch queue conditions fluctuate.
- **`BR-08` (Explicit Consent for Push)**: Browser permission requests MUST only happen in response to an explicit customer/owner click—never on initial page load.
- **`BR-09` (Platform Admin PII Minimization)**: Platform admins can monitor tenant health, usage, and suspended statuses without unrestricted access to raw customer names/mobile numbers.
