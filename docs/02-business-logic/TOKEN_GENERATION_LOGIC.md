# Token Generation Logic

## 1. Requirements

- **Branch & Business-Date Independent**: `Main Branch` and `West Branch` of the same salon both start at `A001` each business day without collision.
- **Timezone-Aware Business Date**: Computed from server UTC time using `Branch.timezone` and `SalonSettings.dayResetTime`.
- **Concurrency-Safe & Atomic**: Zero duplicate sequences under simultaneous QR bursts.
- **Zero Side-Effect Coupling**: Notification failures never abort or invalidate token generation.

---

## 2. Branch Business Date Calculation

1. Read `nowUtc = new Date()`, `tz = branch.timezone` (e.g. `"Asia/Kolkata"`), and `dayResetTime` (e.g. `"00:00"` or `"04:00"`).
2. Format `nowUtc` into `(year, month, day, hour, minute)` in `tz` via `Intl.DateTimeFormat`.
3. If `(hour, minute) < (resetHour, resetMinute)`, roll back 1 calendar day to derive `businessDate` (`YYYY-MM-DD`).
4. Persist `businessDate` as PostgreSQL `@db.Date`.

---

## 3. Atomic Counter & Transaction Sequence

Executed inside `prisma.$transaction(..., { isolationLevel: 'ReadCommitted' })`:

1. **Idempotency Short-Circuit**: Check `Token` by `(organizationId, branchId, idempotencyKey)`. If matched, return existing token's `publicId` (`200 OK`) cleanly.
2. **Advisory Lock for Duplicate Mobile Guard**:
   ```sql
   SELECT pg_advisory_xact_lock(hashtext($1)); -- $1 = branchId + ':' + normalizedMobile
   ```
   Prevents two parallel submissions from the same mobile number slipping past duplicate checks.
3. **Duplicate Active Token Verification**:
   If `settings.allowDuplicateActiveTokens === false`, check for existing token where `branchId`, `customer.mobileNumber = normalizedMobile`, and `status IN ('WAITING', 'CALLED', 'IN_SERVICE')`. Abort with `409 ACTIVE_TOKEN_EXISTS` if present.
4. **Customer Upsert (Branch-Scoped)**: Upsert `Customer` keyed by `(branchId, mobileNumber)` (with `organizationId`).
5. **Atomic Branch Sequence Allocation**:
   ```sql
   INSERT INTO "queue_counters" ("id", "organization_id", "branch_id", "business_date", "prefix", "last_number", "updated_at")
   VALUES ($1, $2, $3, $4::date, $5, 1, NOW())
   ON CONFLICT ("branch_id", "business_date", "prefix")
   DO UPDATE SET
     "last_number" = "queue_counters"."last_number" + 1,
     "updated_at" = NOW()
   RETURNING "last_number";
   ```
6. **Format & Cryptographic Public ID**:
   - `tokenNumber = `${prefix}${String(lastNumber).padStart(3, '0')}`` (`A001`..`A999`, `A1000`).
   - `publicId = crypto.randomBytes(16).toString('base64url')` (128-bit entropy, 22 URL-safe chars).
7. **Persist Entities & Outbox**:
   - Insert `Token` (`status = 'WAITING'`, `source = 'QR' | 'WALK_IN'`, `sequenceNumber = lastNumber`).
   - Insert `TokenService[]` (capturing `serviceNameSnapshot`, effective `priceInPaiseSnapshot`, `durationMinutesSnapshot`).
   - Insert `AuditLog` (`TOKEN_CREATED`, `metadata: { source }`).
   - Insert `NotificationEvent` outbox rows (`NEW_TOKEN_OWNER_ALERT`, `idempotencyKey = "token:" + token.id + ":NEW_TOKEN_OWNER_ALERT"`, `status = 'PENDING'`).
8. **Commit Transaction**, then asynchronously nudge in-process job dispatcher and broadcast single-pass SSE update (`TOKEN_CREATED`)!
