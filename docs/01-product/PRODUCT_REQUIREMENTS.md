# Product Requirements Document (PRD)

## 1. Platform Administrator Requirements (`FR-PA`)
- `FR-PA-01`: View list of all registered `Organization` tenants (filter by status, search name/slug).
- `FR-PA-02`: Create/activate/suspend/reactivate tenant accounts (suspended tenants immediately block new customer intake and staff dashboard mutations with clear status notice).
- `FR-PA-03`: View platform-level aggregated statistics (total organizations, active branches, daily token volume, background job failure rate, system health).
- `FR-PA-04`: Manage global platform operational settings (e.g., default rate limit policies, onboarding approval mode).
- `FR-PA-05`: View failed/dead-letter notification jobs and system logs for incident investigation.
- `FR-PA-06`: **Privacy Guard**: Platform admins must NOT have unrestricted browsing access to customer names or mobile numbers in standard views; PII remains masked/redacted unless explicitly required and audit-logged.

---

## 2. Salon Owner & Staff Requirements (`FR-OS`)

### Onboarding & Branch Management
- `FR-OS-01`: Register a new salon business (`Organization`) with primary user account and initial `Branch`.
- `FR-OS-02`: Create, edit, activate/deactivate multiple `Branch` locations under the organization (`slug` unique per organization).
- `FR-OS-03`: Configure branch timezone (default `Asia/Kolkata`), address, contact phone, and 7-day `BusinessHours`.
- `FR-OS-04`: Configure `SalonSettings` (token prefix, active stations count, duplicate active token policy, customer self-cancel toggle, notification thresholds, day reset time).

### Services & Branch Pricing
- `FR-OS-05`: Manage organization-level `Service` catalog (name, description, base price in paise, base duration in mins).
- `FR-OS-06`: Configure `BranchService` per branch (enable/disable availability at that branch, optional branch-specific price/duration overrides).
- `FR-OS-07`: Soft-deactivate services without mutating historical `TokenService` snapshots.

### Staff & RBAC Management
- `FR-OS-08`: Invite staff members (`OrganizationMember`), assign `StaffRole` (`OWNER`, `MANAGER`, `STAFF`, or custom roles with granular `RolePermission`s), and bind branch scope (`allBranches` or specific assigned branches).
- `FR-OS-09`: Revoke staff access or suspend membership immediately (`sessionVersion` / member status invalidation).

### Live FIFO Queue Operations
- `FR-OS-10`: Overview KPIs per branch/business date: Total tokens today, Waiting, Currently Serving (`IN_SERVICE`), Completed, Cancelled, Average wait time, Average service duration.
- `FR-OS-11`: Live FIFO queue list displaying token number, source (`QR` or `WALK_IN`), customer name, mobile number, requested services, registration time, estimated waiting time, and status indicator (`WAITING`, `CALLED`, `IN_SERVICE`, `COMPLETED`, `SKIPPED`, `CANCELLED`, `NO_SHOW`).
- `FR-OS-12`: Execute strict FIFO actions: `Call Next` (earliest eligible `WAITING` token), `Start Service`, `Complete Service`, `Skip Customer`, `Re-queue Skipped Customer` (issues new FIFO sequence at back of queue while preserving original token history), `Cancel Token`, `Mark No-Show`, and **Manual Walk-In Entry** (`source = 'WALK_IN'`).
- `FR-OS-13`: Prevent simultaneous staff clicks from calling the same token twice.

### QR Code, Push & Analytics
- `FR-OS-14`: Generate stable branch QR code pointing to `/salon/{salon-slug}/{branch-slug}`; view, copy URL, download high-res PNG, and print formatted poster.
- `FR-OS-15`: Opt in to Web Push notifications across multiple devices; receive test notification; view delivery history & retry failures.
- `FR-OS-16`: View tenant-scoped analytics: daily/weekly/monthly trends, top requested services, average wait & service durations, and cross-branch comparison.

---

## 3. Customer Requirements (`FR-CU`)
- `FR-CU-01`: Scan branch QR code (`/salon/{salon-slug}/{branch-slug}`) to open mobile intake form without login/app install.
- `FR-CU-02`: View salon name, branch name, live open/closed status, and selectable available branch services (showing name, description, price in `₹`, duration).
- `FR-CU-03`: Submit Full Name (required), valid 10-digit Indian mobile number (required), `>= 1` available branch service (required), and optional instructions.
- `FR-CU-04`: Receive unique branch-specific daily atomic token (`A001`, `A002`, ...) and redirect to unguessable status page (`/salon/{salon-slug}/{branch-slug}/token/{publicId}`).
- `FR-CU-05`: Confirmation page displays `"Your token has been generated successfully!"`, `"Please wait for your turn. We will notify you when your turn is approaching."`, salon & branch name, customer name, large token number, selected services, live position, estimated wait time, creation time, and status.
- `FR-CU-06`: **Opt-In Web Push**: Display optional push invitation card on confirmation screen *only after* token creation; never auto-prompt on arrival. Send push notifications on confirmation (if enabled), 3 ahead, 1 ahead, called, and major queue delays without duplicate firing.
- `FR-CU-07`: Live status page updates automatically via SSE/polling even if push permission is denied or unsupported.
- `FR-CU-08`: **Self-Cancellation**: Customer may cancel their token **ONLY while status is `WAITING`** (when branch `allowCustomerCancel === true`), disabled once `CALLED` or `IN_SERVICE`, with full audit logging.
