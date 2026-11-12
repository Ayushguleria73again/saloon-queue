# Security Requirements — SalonFlow SaaS

## 1. Input Validation, SQLi & XSS Protection
- **Zod Server Validation**: Validate every payload, URL slug, UUID parameter, and query string strictly on the server.
- **SQL Injection Prevention**: Use Prisma ORM parameterized operations; any raw SQL (`QueueCounter`, `SKIP LOCKED`, `set_config` for RLS) MUST use parameterized `Prisma.sql` tagged queries.
- **XSS Prevention**: React JSX auto-escaping; strict CSP; sanitize control characters from user text inputs; Service Worker (`sw.js`) renders notifications exclusively using plain text (`Notification.title` / `body`) and validates `targetUrl` is a same-origin relative path before `clients.openWindow()`!

---

## 2. Transport, Headers & CSRF Protection
- Enforce HTTPS in production (`HSTS: max-age=31536000; includeSubDomains`).
- Set `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
- **CSP**: `default-src 'self'; script-src 'self'; img-src 'self' data: blob:; worker-src 'self'; connect-src 'self'; frame-ancestors 'none'`.
- **CSRF**: Auth.js built-in CSRF protection; `SameSite=Lax; HttpOnly; Secure` cookies; `Origin` / `Host` parity validation on authenticated state-changing routes (`/api/owner/*`, `/api/admin/*`).

---

## 3. Web Push & Cryptographic Controls
- **Unguessable Token URLs**: `Token.publicId` generated via `crypto.randomBytes(16).toString('base64url')` (128-bit entropy).
- **Push Subscription Validation**: Reject non-HTTPS push endpoints, localhost/private IP endpoints (SSRF defense), and malformed `p256dh`/`auth` keys.
- **VAPID Key Security**: Never expose `VAPID_PRIVATE_KEY` to client bundles or logs; expose only `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.
- **Secrets Management**: Zod startup validation; zero secrets committed to Git.
