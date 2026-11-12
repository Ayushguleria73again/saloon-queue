# Database Design Specification (PostgreSQL + Prisma)

## 1. Schema Principles

1. **Tenant-Scoped Composite Foreign Keys**: Core operational tables carry `organizationId` and reference parent composite unique constraints `(organizationId, id)` so cross-tenant foreign-key mismatches are physically rejected by PostgreSQL.
2. **Branch-Independent Queues**: `Branch` owns its own `QueueCounter`, `BusinessHours`, `BranchService`, `Token`, and `PushSubscription` associations.
3. **Integer Currency**: Store prices as integer paise (`Int`).
4. **Immutable Snapshots**: `Token` and `TokenService` snapshot customer & service values at booking time.
5. **Cryptographic Public Keys**: `Token.publicId` (128-bit base64url) is the sole public token lookup key.

---

## 2. Enumerations

```prisma
enum OrganizationStatus {
  PENDING
  ACTIVE
  SUSPENDED
  DEACTIVATED
}

enum MemberStatus {
  INVITED
  ACTIVE
  SUSPENDED
  REVOKED
}

enum TokenStatus {
  WAITING
  CALLED
  IN_SERVICE
  COMPLETED
  SKIPPED
  CANCELLED
  NO_SHOW
}

enum TokenSource {
  QR
  WALK_IN
}

enum PushSubscriberType {
  OWNER_STAFF
  CUSTOMER
}

enum NotificationChannel {
  WEB_PUSH
}

enum OutboxEventStatus {
  PENDING
  PROCESSING
  PROCESSED
  RETRYING
  DEAD_LETTER
}

enum NotificationDeliveryStatus {
  QUEUED
  ACCEPTED_BY_PROVIDER
  RETRYING
  FAILED
  DEAD_LETTER
  ACKNOWLEDGED
}

enum ActorType {
  CUSTOMER
  OWNER
  STAFF
  PLATFORM_ADMIN
  SYSTEM
}
```

---

## 3. Core Entities (All 19 Required Entities + RBAC/Branch Access Joins)

### 3.1 `users` (`User`)
- `id` (UUID PK), `name`, `email` (UNIQUE), `emailVerifiedAt` (`TIMESTAMPTZ`, nullable), `emailVerificationTokenHash` (nullable), `emailVerificationExpiresAt` (nullable), `passwordHash`, `isPlatformAdmin` (Boolean, default `false`), `isActive`, `sessionVersion` (Int, default `1`), `failedLoginAttempts`, `lockedUntil`, `lastLoginAt`, `createdAt`, `updatedAt`.

### 3.2 `organizations` (`Organization`)
- `id` (UUID PK), `name`, `slug` (UNIQUE), `status` (`OrganizationStatus`, default `'ACTIVE'`), `createdAt`, `updatedAt`.

### 3.3 `staff_roles` (`StaffRole`)
- `id` (UUID PK), `organizationId` (FK -> `organizations.id`), `name`, `slug` (`'OWNER'`, `'MANAGER'`, `'STAFF'`, or custom), `isSystemDefault` (Boolean), `createdAt`, `updatedAt`.
- **Unique**: `UNIQUE (organizationId, slug)`, `UNIQUE (organizationId, id)` *(for composite FK target)*.

### 3.4 `role_permissions` (`RolePermission`)
- `id` (UUID PK), `organizationId` (UUID), `staffRoleId` (UUID), `permissionKey` (VARCHAR e.g. `'QUEUE_CALL_NEXT'`), `createdAt`.
- **Composite FK**: `(organizationId, staffRoleId) -> staff_roles(organizationId, id)` (CASCADE).
- **Unique**: `UNIQUE (staffRoleId, permissionKey)`.

### 3.5 `organization_members` (`OrganizationMember`)
- `id` (UUID PK), `organizationId` (FK -> `organizations.id`), `userId` (FK -> `users.id`), `staffRoleId` (UUID), `allBranches` (Boolean, default `false`), `status` (`MemberStatus`), `inviteTokenHash` (nullable), `inviteExpiresAt` (nullable), `createdAt`, `updatedAt`.
- **Composite FK**: `(organizationId, staffRoleId) -> staff_roles(organizationId, id)`.
- **Unique**: `UNIQUE (organizationId, userId)`, `UNIQUE (organizationId, id)`.

### 3.6 `staff_branch_access` (`StaffBranchAccess`) *(Supporting Join)*
- `id` (UUID PK), `organizationId` (UUID), `memberId` (UUID), `branchId` (UUID), `createdAt`.
- **Composite FKs**:
  - `(organizationId, memberId) -> organization_members(organizationId, id)` (CASCADE)
  - `(organizationId, branchId) -> branches(organizationId, id)` (CASCADE)
- **Unique**: `UNIQUE (memberId, branchId)`.

### 3.7 `branches` (`Branch`)
- `id` (UUID PK), `organizationId` (FK -> `organizations.id`), `name`, `slug`, `phone`, `address`, `city`, `timezone` (default `'Asia/Kolkata'`), `qrToken`, `isActive` (Boolean, default `true`), `createdAt`, `updatedAt`.
- **Unique**: `UNIQUE (organizationId, slug)`, `UNIQUE (organizationId, id)` *(composite FK target)*.

### 3.8 `salon_settings` (`SalonSettings`)
- `id` (UUID PK), `organizationId` (FK -> `organizations.id`), `branchId` (UUID, nullable = org default, non-null = branch override), `tokenPrefix` (default `'A'`), `activeStationsCount` (Int, default `1`), `allowDuplicateActiveTokens` (default `false`), `allowCustomerCancel` (default `true`), `enforceBusinessHours` (default `true`), `isAcceptingTokens` (default `true`), `queuePausedReason`, `requireValidQrToken` (default `false`), `dayResetTime` (`'00:00'`), `estimatedBufferMinutes` (Int, default `0`), `customerPushThresholds` (Int[], default `[3, 1]`), `notifyDelayThresholdMinutes` (Int, default `15`), `longQueueAlertThreshold` (Int, default `10`), `updatedAt`.
- **Composite FK (when branchId present)**: `(organizationId, branchId) -> branches(organizationId, id)`.
- **Unique**: `UNIQUE (organizationId, branchId)` (plus partial unique `WHERE branch_id IS NULL` for org default).

### 3.9 `business_hours` (`BusinessHours`)
- `id` (UUID PK), `organizationId`, `branchId`, `dayOfWeek` (`0..6`), `isOpen`, `openTime` (`'09:30'`), `closeTime` (`'21:30'`), `breakStartTime` (nullable), `breakEndTime` (nullable).
- **Composite FK**: `(organizationId, branchId) -> branches(organizationId, id)` (CASCADE).
- **Unique**: `UNIQUE (branchId, dayOfWeek)`.

### 3.10 `customers` (`Customer`)
- `id` (UUID PK), `organizationId` (UUID), `branchId` (UUID), `name`, `countryCode` (default `'+91'`), `mobileNumber` (normalized 10-digit), `createdAt`, `updatedAt`.
- **Composite FK**: `(organizationId, branchId) -> branches(organizationId, id)` (CASCADE).
- **Unique**: `UNIQUE (branchId, mobileNumber)`, `UNIQUE (organizationId, branchId, id)`.

### 3.11 `services` (`Service`)
- `id` (UUID PK), `organizationId` (FK -> `organizations.id`), `name`, `description`, `basePriceInPaise` (Int >= 0), `baseDurationMinutes` (Int > 0), `isActive` (soft-delete flag, default `true`), `sortOrder` (Int), `createdAt`, `updatedAt`.
- **Unique**: `UNIQUE (organizationId, id)`.

### 3.12 `branch_services` (`BranchService`)
- `id` (UUID PK), `organizationId`, `branchId`, `serviceId`, `isAvailable` (Boolean, default `true`), `priceOverrideInPaise` (Int, nullable), `durationOverrideMinutes` (Int, nullable), `sortOrder` (Int), `updatedAt`.
- **Composite FKs**:
  - `(organizationId, branchId) -> branches(organizationId, id)` (CASCADE)
  - `(organizationId, serviceId) -> services(organizationId, id)` (CASCADE)
- **Unique**: `UNIQUE (branchId, serviceId)`, `UNIQUE (organizationId, branchId, serviceId)`.

### 3.13 `queue_counters` (`QueueCounter`)
- `id` (UUID PK), `organizationId`, `branchId`, `businessDate` (`DATE`), `prefix` (`'A'`), `lastNumber` (Int, default `0`), `updatedAt`.
- **Composite FK**: `(organizationId, branchId) -> branches(organizationId, id)` (CASCADE).
- **Unique**: `UNIQUE (branchId, businessDate, prefix)`.

### 3.14 `tokens` (`Token`)
- `id` (UUID PK), `publicId` (UNIQUE, 32-char cryptographic), `organizationId`, `branchId`, `customerId`, `businessDate` (`DATE`), `sequenceNumber` (Int), `tokenNumber` (`'A001'`), `source` (`TokenSource`: `'QR' | 'WALK_IN'`), `requeuedFromTokenId` (UUID, nullable; inverse 1:1 relation `requeuedToToken` exposes forward link cleanly without redundant column drift), `customerNameSnapshot`, `customerMobileSnapshot`, `notes`, `status` (`TokenStatus`), `totalPriceInPaise`, `totalDurationMinutes`, `idempotencyKey`, `createdAt`, `calledAt`, `serviceStartedAt`, `completedAt`, `skippedAt`, `cancelledAt`, `noShowAt`, `updatedAt`.
- **Composite FKs**:
  - `(organizationId, branchId) -> branches(organizationId, id)` (CASCADE)
  - `(organizationId, branchId, customerId) -> customers(organizationId, branchId, id)` (RESTRICT)
- **Unique Constraints**:
  - `UNIQUE (publicId)`
  - `UNIQUE (organizationId, id)` *(composite FK target)*
  - `UNIQUE (branchId, businessDate, sequenceNumber)`
  - `UNIQUE (branchId, businessDate, tokenNumber)`
  - `UNIQUE (branchId, idempotencyKey)`
  - `UNIQUE (requeuedFromTokenId)` *(prevents duplicate re-queue of same skipped token)*

### 3.15 `token_services` (`TokenService`)
- `id` (UUID PK), `organizationId`, `tokenId`, `serviceId`, `serviceNameSnapshot`, `priceInPaiseSnapshot`, `durationMinutesSnapshot`, `createdAt`.
- **Composite FKs**:
  - `(organizationId, tokenId) -> tokens(organizationId, id)` (CASCADE)
  - `(organizationId, serviceId) -> services(organizationId, id)` (RESTRICT)

### 3.16 `push_subscriptions` (`PushSubscription`)
- `id` (UUID PK), `organizationId`, `branchId` (nullable for org-wide owner devices), `subscriberType` (`PushSubscriberType`: `OWNER_STAFF` | `CUSTOMER`), `userId` (nullable FK -> `users.id`), `tokenId` (nullable FK -> `tokens.id`), `endpoint` (TEXT), `p256dh` (TEXT), `auth` (TEXT), `deviceLabel`, `preferences` (JSONB: event flags for owner/staff), `consentGivenAt` (TIMESTAMPTZ), `isActive` (Boolean, default `true`), `revokedAt` (nullable), `revokedReason` (nullable), `lastUsedAt`, `createdAt`, `updatedAt`.
- **Unique Constraints**:
  - `UNIQUE (organizationId, id)`
  - `UNIQUE (userId, endpoint)` *(partial where `userId IS NOT NULL`)*
  - `UNIQUE (tokenId, endpoint)` *(partial where `tokenId IS NOT NULL`)*

### 3.17 `notification_events` (`NotificationEvent` — Transactional Outbox)
- `id` (UUID PK), `organizationId`, `branchId` (nullable), `tokenId` (nullable), `eventType` (VARCHAR: e.g. `NEW_TOKEN_CREATED`, `CUSTOMER_APPROACHING_3`, `CUSTOMER_APPROACHING_1`, `TOKEN_CALLED`, `QUEUE_DELAYED`), `idempotencyKey` (VARCHAR), `payload` (JSONB), `status` (`OutboxEventStatus`), `attemptCount` (Int), `maxAttempts` (Int, default `5`), `nextAttemptAt` (TIMESTAMPTZ), `lockedUntil` (TIMESTAMPTZ, nullable), `lockedBy` (VARCHAR, nullable), `lastError` (TEXT, nullable), `processedAt` (nullable), `createdAt`, `updatedAt`.
- **Unique**: `UNIQUE (organizationId, idempotencyKey)`, `UNIQUE (organizationId, id)`.

### 3.18 `notifications` (`Notification`)
- `id` (UUID PK), `organizationId`, `branchId` (nullable), `notificationEventId` (UUID), `pushSubscriptionId` (UUID, nullable), `recipientUserId` (UUID, nullable), `tokenId` (UUID, nullable), `channel` (`WEB_PUSH`), `title`, `body`, `targetUrl`, `status` (`NotificationDeliveryStatus`), `attemptCount` (Int), `acknowledgedAt` (nullable), `createdAt`, `updatedAt`.
- **Composite FKs**:
  - `(organizationId, notificationEventId) -> notification_events(organizationId, id)` (CASCADE)
  - `(organizationId, id)` UNIQUE target for delivery attempts.

### 3.19 `notification_deliveries` (`NotificationDelivery`)
- `id` (UUID PK), `organizationId`, `notificationId`, `attemptNumber` (Int), `status` (`NotificationDeliveryStatus`), `httpStatusCode` (Int, nullable), `providerResponse` (JSONB, nullable), `errorCode` (VARCHAR, nullable), `errorMessage` (TEXT, nullable), `durationMs` (Int, nullable), `attemptedAt` (TIMESTAMPTZ).
- **Composite FK**: `(organizationId, notificationId) -> notifications(organizationId, id)` (CASCADE).

### 3.20 `audit_logs` (`AuditLog`)
- `id` (UUID PK), `organizationId` (nullable ONLY for Platform Admin global actions; non-null for all tenant events), `branchId` (nullable), `actorType` (`ActorType`), `actorId` (nullable), `action`, `entityType`, `entityId`, `metadata` (JSONB), `ipAddressHash`, `userAgent`, `createdAt`.
