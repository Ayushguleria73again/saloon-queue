# Notification Architecture (Web Push + Transactional Outbox)

## 1. End-to-End Pipeline

```text
Business Transaction (e.g., Token Created / Call Next / Complete)
   │
   ├──► Persist Domain State (Token, QueueCounter, AuditLog)
   └──► Persist Outbox Row (NotificationEvent: PENDING + unique idempotencyKey)
   │
[COMMIT] ──► Immediate HTTP 201/200 Response (Never waits on Push network!)
   │
   ▼ (Async Signal / Poll Loop)
Background Job Processor (Claims pending NotificationEvents via SKIP LOCKED)
   │
   ▼
Notification Processor
   ├── Evaluates tenant/user/customer preferences & consent
   ├── Resolves active PushSubscriptions (multi-device owner/staff OR token-scoped customer)
   ├── Creates Notification & NotificationDelivery attempt rows
   └── Calls Web Push Provider (VAPID JWT + AES-GCM encrypted payload)
          │
          ├── 201 Created (Push Service Accepted) ─► Status: ACCEPTED_BY_PROVIDER
          ├── 404 / 410 Gone (Expired/Unsubscribed) ─► Mark PushSubscription INACTIVE
          ├── 429 / 5xx / Network Timeout ─► Exponential Backoff Retry -> DEAD_LETTER
          └── Service Worker Receipt / Click Ack (Optional) ─► Status: ACKNOWLEDGED
```

---

## 2. Delivery Lifecycle & Honest Status Tracking

SalonFlow explicitly distinguishes **push provider acceptance** from **actual device acknowledgement** (Section 14 requirement):

| Status | Exact Meaning |
| :--- | :--- |
| `QUEUED` | `Notification` created; awaiting worker dispatch |
| `ACCEPTED_BY_PROVIDER` | Browser push service (FCM/Mozilla/APNS) returned HTTP `201` (message queued at push vendor—NOT guaranteed visible on screen yet if phone is offline!) |
| `RETRYING` | Transient error (`429`, `5xx`, timeout); scheduled for exponential retry |
| `FAILED` | Attempt failed (recorded on `NotificationDelivery` log) |
| `DEAD_LETTER` | Exhausted `maxRetries` or unrecoverable configuration error; requires admin/owner inspection |
| `ACKNOWLEDGED` | Optional callback from `/sw.js` confirming user's Service Worker displayed/handled notification or user clicked notification |

---

## 3. VAPID & Subscription Security

- **VAPID Keys**: Platform-wide `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` (`mailto:` subject), securely stored in environment variables.
- **Endpoint Validation**: Validate `subscription.endpoint` is a valid HTTPS URL (reject `http://`, `localhost` SSRF targets, or private IPs in production!), and validate `p256dh` / `auth` base64 lengths via Zod.
- **Multi-Device & Scoping**:
  - Owner/Staff: `(organizationId, userId, branchId?)` — supports multiple browsers/devices simultaneously.
  - Customer: `(organizationId, branchId, tokenId)` — strictly isolated to that single token.
- **Expired Subscription Cleanup**: Any `404` or `410 Gone` response from the push service immediately deactivates `PushSubscription.isActive = false` (`revokedAt = NOW()`) so future events don't waste retries on dead endpoints.

---

## 4. Future Optional Integrations (Post-MVP)

Web Push + Service Workers is the **sole primary notification provider for MVP** across owners, staff, and customers. Because events flow through an independent `NotificationEvent` outbox and `NotificationProcessor`, secondary channels such as **Telegram Bot**, **WhatsApp Business Cloud API**, or **SMS** can be added post-MVP as optional tenant-configurable adapters without modifying core token or queue services.
