# Information Architecture

## 1. Three Isolated Application Experiences

SalonFlow cleanly isolates routes using Next.js App Router Route Groups so public customer pages never load heavy admin charts or owner auth JS, and platform admin routes remain isolated from tenant workflows:

1. **Public Customer Surface** (`src/app/(public)/`)
2. **Owner & Staff SaaS Workspace** (`src/app/(auth)/` & `src/app/(owner)/owner/`)
3. **Platform Admin Console** (`src/app/(admin)/`)

---

## 2. Complete Route Hierarchy

### A. Public & Auth Routes
| Route | Role | Purpose |
| :--- | :--- | :--- |
| `/` | Public | Public SaaS landing page ("Register Your Salon" & "Sign In") |
| `/register` | New Salon Owner | Self-serve salon business + initial branch registration |
| `/login` | Owner/Staff/Admin | Unified secure session sign-in |
| `/invite/[token]` | Invited Staff | Accept staff invite & activate membership |
| `/salon/[slug]/[branch]` | Customer | Branch QR landing & <30s token booking form |
| `/salon/[slug]/[branch]/token/[publicId]` | Customer | Live token status ticket, SSE tracking & optional push opt-in |

### B. Owner & Staff Workspace (`/owner/*`)
| Route | Min Permission | Purpose |
| :--- | :--- | :--- |
| `/owner/dashboard` | Authenticated Member | Overview KPIs across selected branch + quick operational jump links |
| `/owner/queue` | `QUEUE_VIEW` (+ Branch access) | Live FIFO Queue Console (`Call Next`, actions, `+ Add Walk-In`, branch switcher) |
| `/owner/branches` | `BRANCH_MANAGE` | Create/edit branches, business hours, stations, timezone, QR & active status |
| `/owner/services` | `SERVICE_MANAGE` | Organization services + per-branch `BranchService` availability/price/duration overrides |
| `/owner/settings` | `SETTINGS_MANAGE` / Member | Branch/Org queue rules (`allowCustomerCancel`, thresholds) + Web Push device onboarding & logs |
| `/owner/history` | `HISTORY_VIEW` (+ Branch access) | Branch token history with date/status/search filters |
| `/owner/qr` | `QR_MANAGE` | Branch QR preview, Copy URL, Download PNG, Printable Poster, Print |
| `/owner/staff` | `STAFF_MANAGE` | Invite staff, manage `StaffRole`s & permissions, assign branches, revoke |
| `/owner/analytics` | `ANALYTICS_VIEW` | Daily/weekly/monthly trends, top services, wait/service times, branch comparison |

### C. Platform Admin Console (`/admin/*`)
| Route | Role | Purpose |
| :--- | :--- | :--- |
| `/admin` | Platform Admin | Platform KPIs (total tenants, branches, daily tokens, outbox health) |
| `/admin/tenants` | Platform Admin | Tenant directory, Activate/Suspend controls, non-PII operational inspection |
| `/admin/jobs` | Platform Admin | Background job backlog, retry/dead-letter inspection |
