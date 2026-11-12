# Rate Limiting Specification

## 1. Shared Salon Wi-Fi Consideration

Walk-in customers frequently scan the branch QR code over the salon's shared Wi-Fi, sharing one public IP across dozens of legitimate bookings per hour. Rate limits balance bot/flood protection with shared-IP tolerance.

---

## 2. Rate Limit Rules

| Endpoint / Action | Key Scope | Limit | Window | Notes |
| :--- | :--- | :---: | :---: | :--- |
| `POST /api/public/salons/[s]/[b]/tokens` | `ipHash + branchId` | **20 req** | `10 mins` | Tolerates shared salon Wi-Fi bursts |
| `POST /api/public/salons/[s]/[b]/tokens` | `mobileNumber + branchId` | **3 req** | `15 mins` | Stops repeated join-cancel spam |
| `POST /api/public/tokens/[publicId]/push-subscription` | `ipHash + publicId` | **10 req** | `10 mins` | Prevents push subscription flooding |
| `GET /api/public/tokens/[publicId]` | `ipHash` | **60 req** | `1 min` | Supports polling fallback safely |
| `POST /api/public/tokens/[publicId]/cancel` | `ipHash + publicId` | **5 req** | `5 mins` | |
| `POST /api/auth/callback/credentials` | `ipHash` | **10 req** | `15 mins` | Plus 5-fail account lockout |
| `POST /api/auth/register-salon` | `ipHash` | **5 req** | `1 hour` | Stops mass fake tenant signup |
| `POST /api/owner/push-subscriptions/test` | `userId` | **5 req** | `5 mins` | Prevents push vendor spam |

---

## 3. Pluggable Scalable Implementation

- `RateLimiter` async interface (`src/server/security/rate-limiter.ts`):
  - **Single-Node Default**: Bounded LRU sliding-window memory store (`< 0.1ms` per check).
  - **Multi-Instance Horizontal Scale-Out**: Redis/Upstash or PostgreSQL `UNLOGGED` bucket adapter.
- Returns `429 RATE_LIMITED` with `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`.
