# SaaS Scope & Boundaries (`SAAS_SCOPE.md`)

## 1. In-Scope (Platform MVP — Phases 0 to 17)

### Multi-Tenant SaaS & Platform Administration
- Organization self-registration + initial branch setup.
- Multi-branch creation, configuration, activation/suspension, timezone & business hours per branch.
- RBAC (`OrganizationMember`, `StaffRole`, `RolePermission`, `StaffBranchAccess`) with staff invitation workflow and branch-level access control.
- Platform Admin console: tenant management (`ACTIVE` / `SUSPENDED`), aggregated platform metrics, background job & push health inspection, PII-protected diagnostics.

### Customer QR & Tracking Experience
- Branch-specific QR route `/salon/{salon-slug}/{branch-slug}` (resolved securely by slugs).
- Mobile-first intake form (Name, 10-digit Indian mobile, multi-select `BranchService` cards, notes).
- Input validation, bot/spam mitigation, rate limiting, idempotency protection, duplicate active token guard.
- Atomic daily branch token generation (`A001`, `A002`, ...) + unguessable token status URL (`/token/{publicId}`).
- Live status updates (SSE + `ETag` smart polling fallback) and opt-in customer Web Push notifications (`3 ahead`, `1 ahead`, `called`, major delays).

### Salon Owner & Staff Dashboard (`/owner/*`)
- Responsive dashboard with branch switcher (for multi-branch owners/staff with access).
- Overview KPIs (Total today, Waiting, Serving, Completed, Cancelled, Avg Wait, Avg Service Duration).
- Strict FIFO Queue Console (`Call Next`, `Start Service`, `Complete`, `Skip`, `Re-queue` generating new tail sequence, `Cancel`, `Mark No-Show`) + **Manual Walk-In Token Creation** (`source: WALK_IN`).
- Services catalog + per-branch availability, price, and duration overrides.
- QR Studio (View, Copy URL, Download PNG, Download Printable Poster, Print).
- Multi-device Owner/Staff Web Push management, test alert, delivery logs & retries.
- Tenant-scoped Analytics (daily/weekly/monthly trends, popular services, average wait/duration, branch comparisons).

---

## 2. Explicitly Out of Scope (v1 Initial Release)

| Excluded Feature | Rationale |
| :--- | :--- |
| **Manual Queue Reordering / VIP Priority Jumping** | Violates Section 6 requirement: strict FIFO only in v1 (`No manual reordering / No priority customers in initial version`). |
| **Future Calendar / Time-Slot Appointments** | Focuses purely on real-time walk-in FIFO queues. |
| **Online Payment Gateway / Billing Subscriptions** | Tenant plan billing/Stripe/Razorpay invoicing deferred to v2 commercial tiering (`Organization` ready for `planTier` column later). |
| **SMS / WhatsApp Paid Gateways** | Replaced by zero-cost Web Push API + Service Workers for v1. |
| **Microservices / Turborepo Monorepo** | Explicitly prohibited by Section 12; modular monolith only. |
| **Customer Accounts / OTP Logins** | Conflicts with zero-friction QR scan vision. |

