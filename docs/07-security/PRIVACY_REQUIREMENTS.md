# Privacy & Data Protection Requirements

## 1. Data Minimization & Consent

- **Customer Data Collected**: Full Name, 10-digit Mobile Number, Selected Services, Optional Notes, plus optional explicit browser `PushSubscription` (`consentGivenAt` recorded).
- **Explicit Push Consent & Opt-Out**:
  - Push permission is requested **only** after a direct user tap on the post-submission confirmation card.
  - Customers can opt out anytime (`DELETE /api/public/tokens/[publicId]/push-subscription`) or revoke browser permission; `Token` status page continues working via live SSE/polling.
  - Customer push subscriptions automatically deactivate upon token completion/cancellation.

---

## 2. PII Access Boundaries

| Role / Surface | Customer Name | Customer Mobile | Notes |
| :--- | :---: | :---: | :--- |
| **Public Branch Page (`/salon/s/b`)** | Hidden | Hidden | Only aggregate `waitingCount` & wait estimate |
| **Public Token Page (`/token/[publicId]`)** | Visible (own ticket) | **Masked (`******3210`) / Omitted** | Protects PII if link/screenshot shared |
| **Duplicate Active Conflict (`409`)** | Hidden | Hidden | Prevents phone-number enumeration |
| **Owner / Staff Dashboard** | Visible (branch-scoped) | Visible (`tel:` for calling) | Authorized operational necessity |
| **Platform Admin Console** | **Redacted / Excluded** | **Redacted / Excluded** | Platform admins inspect health & counts, not customer PII |

---

## 3. IP Anonymization & Retention
- `AuditLog.ipAddressHash` stores `HMAC-SHA256(IP_HASH_SALT, clientIp)`.
- Inactive customer PII is anonymized after `180 days` (`DATA_RETENTION.md`).
