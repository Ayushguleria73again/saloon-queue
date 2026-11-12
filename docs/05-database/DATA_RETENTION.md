# Data Retention & Lifecycle Policy

## 1. Retention Schedule

| Data Category | Retention Window | Automated Action |
| :--- | :--- | :--- |
| **Customer PII (`Customer.name`, `mobileNumber`, `Token.customerNameSnapshot`, `customerMobileSnapshot`)** | `180 days` from last active visit (configurable via `PII_RETENTION_DAYS`) | Background retention job anonymizes stale customer records (`name = 'Anonymized Customer'`, `mobileNumber = 'REDACTED_<hash>'`) while preserving anonymized service & wait-time analytics! |
| **Customer `PushSubscription`s** | Active during visit; `30 days` post-completion | Deactivated immediately upon terminal token status (`COMPLETED`/`CANCELLED`/`NO_SHOW`/`SKIPPED`); hard-deleted after `30 days`. |
| **Expired Owner/Staff `PushSubscription`s** | `30 days` after `404`/`410` revocation | Purged cleanly by weekly cleanup job. |
| **`NotificationEvent` & `NotificationDelivery`** | `60 days` (`PROCESSED` / logs) | Purged after `60 days` (`DEAD_LETTER` retained `90 days` for audit/diagnostics). |
| **`Token` & `TokenService` (Anonymized Stats)** | `24 months` (or tenant retention setting) | Supports multi-month/yearly branch comparisons without retaining raw phone PII. |
| **`AuditLog`** | `365 days` | Retained for tenant security & compliance investigation (`ipAddressHash` is irreversibly salted HMAC). |

---

## 2. End-of-Day Stale Queue Hygiene

At each branch's business day rollover (executed idempotently by background maintenance job):
- Any prior-day `WAITING` or `CALLED` tokens (`businessDate < currentBranchBusinessDate`) automatically transition to `NO_SHOW` or `CANCELLED` (`AUTO_EXPIRED_END_OF_DAY` in `AuditLog`) and deactivate linked customer push subscriptions so morning queues start fresh.
