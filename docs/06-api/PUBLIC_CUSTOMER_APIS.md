# Public Customer APIs

All public routes validate tenant & branch availability and **never** expose other customers' names, phones, or queue lists.

---

## 1. `GET /api/public/salons/[salonSlug]/[branchSlug]`
Returns branch landing metadata, intake eligibility, cached available `BranchService` catalog, weekly `BusinessHours`, and aggregate wait snapshot (`waitingCount`, `estimatedNewJoinWaitMinutes`).
- **Query**: `?t={qrToken}`
- **Response `200 OK`**:
  ```json
  {
    "organization": { "name": "Aura Grooming Co.", "slug": "aura-grooming" },
    "branch": { "name": "Koramangala", "slug": "koramangala", "city": "Bengaluru", "timezone": "Asia/Kolkata" },
    "intake": { "canAcceptTokens": true, "qrValid": true, "reason": null, "waitingCount": 4, "estimatedNewJoinWaitMinutes": 25 },
    "services": [
      { "id": "svc_uuid", "name": "Haircut", "description": "Classic cut", "priceInPaise": 30000, "durationMinutes": 30 }
    ],
    "businessHours": [ ... ]
  }
  ```

---

## 2. `POST /api/public/salons/[salonSlug]/[branchSlug]/tokens`
Validates intake request, enforces rate limits & duplicate active token policy, runs atomic token transaction, triggers outbox nudge & SSE broadcast.
- **Request Body**:
  ```json
  {
    "fullName": "Rahul Sharma",
    "mobileNumber": "9876543210",
    "serviceIds": ["svc_uuid_1", "svc_uuid_2"],
    "notes": "Fade on sides",
    "idempotencyKey": "550e8400-e29b-41d4-a716-446655440000",
    "qrToken": "optional",
    "website": ""
  }
  ```
  *(Note: `website` is an invisible honeypot field—reject if non-empty).*
- **Response `201 Created`** (`200 OK` on matching `idempotencyKey`):
  ```json
  {
    "token": {
      "publicId": "V1StGXR8_Z5jdHi6B-myT",
      "tokenNumber": "A014",
      "status": "WAITING",
      "queuePosition": 3,
      "peopleAhead": 2,
      "estimatedWaitMinutes": 25,
      "createdAt": "2026-11-10T13:12:00.000Z"
    },
    "redirectUrl": "/salon/aura-grooming/koramangala/token/V1StGXR8_Z5jdHi6B-myT"
  }
  ```

---

## 3. `GET /api/public/tokens/[publicId]`
Returns live ticket state for customer confirmation/status screen. Supports `If-None-Match` (`ETag` -> `304 Not Modified`). **Phone number is omitted/masked (`******3210`).**

---

## 4. `POST /api/public/tokens/[publicId]/cancel`
Self-cancels token **ONLY while status is `WAITING`** and branch `SalonSettings.allowCustomerCancel === true`. Strictly disabled (`409 SELF_CANCEL_NOT_ALLOWED`) once a token is `CALLED` or `IN_SERVICE`. Every cancellation writes an `AuditLog` (`actorType = 'CUSTOMER'`).

---

## 5. `GET /api/public/tokens/[publicId]/events`
SSE stream emitting sanitized `token_update` events whenever queue position/status changes.

---

## 6. Customer Push Subscription Endpoints
- **`POST /api/public/tokens/[publicId]/push-subscription`**:
  - Validates HTTPS endpoint, `p256dh`, `auth`; saves `PushSubscription` (`subscriberType = 'CUSTOMER'`, scoped to `tokenId`, `organizationId`, `branchId`) with `consentGivenAt = NOW()`, and enqueues optional confirmation push (`TOKEN_CONFIRMED_PUSH`).
- **`DELETE /api/public/tokens/[publicId]/push-subscription`**:
  - Revokes customer push subscription (`isActive = false`, `revokedReason = 'CUSTOMER_OPT_OUT'`).
- **`POST /api/public/push/ack`**:
  - Optional Service Worker callback acknowledging receipt/click of a notification (`notificationId`, `publicId`/token signature) updating `Notification.acknowledgedAt`.

