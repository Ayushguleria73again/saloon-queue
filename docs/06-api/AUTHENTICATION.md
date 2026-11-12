# Authentication Specification

## 1. Session Architecture (Auth.js v5)

- **Library**: Auth.js v5 (`next-auth`) using `Credentials` provider (`email` + `password`).
- **Password Hashing**: `argon2` (`argon2id`) — with `bcryptjs` (cost 12) fallback if constrained build environment.
- **Cookie Security**:
  - `HttpOnly`, `SameSite=Lax`, `Secure` (production HTTPS).
  - Encrypted JWT session token carrying minimal claims (`userId`, `activeOrganizationId`, `sessionVersion`, `isPlatformAdmin`).
  - **Session Revocation**: Server verifies `session.sessionVersion === dbUser.sessionVersion` and `OrganizationMember.status === 'ACTIVE'`, ensuring password changes, staff revocations, or tenant suspensions invalidate sessions immediately.

---

## 2. Authentication Endpoints

| Endpoint | Method | Purpose |
| :--- | :--- | :--- |
| `/api/auth/[...nextauth]` | `GET \| POST` | Auth.js login, callback, session read, sign-out (requires verified email) |
| `/api/auth/register-salon` | `POST` | Rate-limited self-serve onboarding (`Organization` `ACTIVE`, `User` unverified + sends verification email) |
| `/api/auth/verify-email` | `POST \| GET` | Verifies email verification token and sets `User.emailVerifiedAt` |
| `/api/auth/invites/[token]/accept` | `POST` | Staff invite acceptance & password setup (marks invited email verified) |
| `/api/owner/account/password` | `POST` | Authenticated password update (rotates `sessionVersion`) |

---

## 3. Brute-Force & Account Lockout Protection

- Email normalized (`trim().toLowerCase()`) prior to lookup.
- Track `User.failedLoginAttempts` & `User.lockedUntil`.
- **5 failed login attempts** lock account for **15 minutes** and record `AuditLog` (`LOGIN_LOCKED`).
- Layered alongside IP sliding-window rate limiting (`10 attempts / 15 mins`).
- Invalid logins always return generic `"Invalid email or password"` (`401`) without disclosing whether the email exists.

