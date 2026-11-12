# Platform Administrator APIs

All endpoints require `User.isPlatformAdmin === true` (`requirePlatformAdmin()`).

## Privacy Rule
Platform Admin APIs expose **tenant metadata, aggregated volume metrics, and non-PII diagnostic states**. Customer names, mobile numbers, and token notes are **redacted/excluded** from admin queries.

---

## Endpoints

- **`GET /api/admin/overview`**:
  - Returns total organizations (`ACTIVE`, `PENDING`, `SUSPENDED`), total active branches, today's platform-wide token count, and background job health (`PENDING`, `RETRYING`, `DEAD_LETTER` counts).
- **`GET /api/admin/tenants`**:
  - Paginated (`limit <= 50`) list of `Organization`s with branch count, member count, 30-day token count, status, and created date. Filterable by `?status=...&q=...`.
- **`PATCH /api/admin/tenants/[organizationId]/status`**:
  - Body: `{ "status": "ACTIVE" | "SUSPENDED", "reason": string }`
  - Records immutable `AuditLog` (`actorType = 'PLATFORM_ADMIN'`).
  - Suspending immediately blocks public QR intake and owner/staff dashboard mutations across all branches of that tenant.
- **`GET /api/admin/jobs`**:
  - Inspects failed / dead-letter `NotificationEvent`s (sanitized metadata: `eventType`, `organizationId`, `attemptCount`, `lastError`, HTTP status—no raw customer phone/name!).
  - Supports `POST /api/admin/jobs/[eventId]/retry` to re-queue a `DEAD_LETTER` event after fixing an operational issue.
- **`GET /api/admin/health/details`**:
  - Database pool metrics, latest migration status, VAPID configuration presence check (boolean only, never key values).

