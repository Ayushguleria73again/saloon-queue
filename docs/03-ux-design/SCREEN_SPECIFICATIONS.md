# Screen Specifications

## 1. Public Customer Screens

### 1.1 Branch QR Intake Page (`/salon/[salonSlug]/[branchSlug]`)
- **Header**: Salon Name + Branch Name badge (e.g., *Aura Grooming Co. — Koramangala*), Open/Closed/Paused indicator, live queue summary (`"4 waiting • ~25 mins approx."`).
- **Existing Local Token Banner** *(conditional)*: Shown if browser `localStorage` holds an active `publicId` for this branch (*"View Your Active Token ->"*).
- **Closed / Suspended / Paused View** *(conditional)*: Clean informative notice with today's & weekly branch opening hours.
- **Form Fields**:
  - `Full Name` (required, 2–80 chars)
  - `Mobile Number` (required, attached `+91` prefix, `inputmode="numeric"`)
  - `Available Services` (multi-select cards showing Name, Description, `₹` price, Estimated duration in mins; unavailable branch services hidden/disabled)
  - `Additional Instructions` (optional textarea, 300 chars)
- **Sticky Bottom Action Bar**: Displays count, total `₹` estimate, total service duration, and prominent **`Get Queue Token`** CTA.

### 1.2 Token Confirmation & Live Status (`/salon/[salonSlug]/[branchSlug]/token/[publicId]`)
- **Required Messages**:
  - Top banner: **`"Your token has been generated successfully!"`**
  - Sub-banner: **`"Please wait for your turn. We will notify you when your turn is approaching."`**
- **Hero Ticket**: Huge Token Number (`A014`), Status Pill (`WAITING`, `CALLED`, `IN_SERVICE`, `COMPLETED`, `SKIPPED`, `CANCELLED`, `NO_SHOW`), Queue Position (`#3`), Estimated Wait (`~20 mins approx.`), Customer Name (mobile masked/omitted), Salon + Branch Name, Created Time, Selected Services.
- **Optional Web Push Opt-In Card** *(shown only while token is active & permission not yet granted)*:
  - Explains benefits clearly (*"Get instant browser alerts when 3 are ahead, 1 is ahead, and when called"*).
  - Button **`Enable Turn Notifications`** triggers permission + SW registration + token-scoped subscription.
  - Shows helpful *"Add to Home Screen for lock-screen alerts on iOS"* if iPhone non-PWA Safari detected.
- **Live Updates Indicator**: Subtle live connection dot (`Live` SSE / `Auto-syncing` polling) + optional `Cancel My Token` button (shown **ONLY while `WAITING`** when branch `allowCustomerCancel === true`; hidden once `CALLED` or `IN_SERVICE`).

---

## 2. Owner & Staff Workspace Screens (`/owner/*`)

### 2.1 Owner Dashboard (`/owner/dashboard`) & Branch Live Queue (`/owner/queue`)
- **Top Bar**: **Branch Switcher** dropdown (if user has access to `> 1` branch), Live Sync pill, Branch Open/Paused quick switch, and **`+ Add Walk-In`** button (`source: WALK_IN`).
- **Overview KPI Strip (7 metrics)**:
  1. `Total Tokens Today`
  2. `Waiting`
  3. `Currently Serving`
  4. `Completed`
  5. `Cancelled` *(plus Skipped/No-Show breakdown tooltip/chip)*
  6. `Avg Waiting Time`
  7. `Avg Service Duration`
- **Primary Action Bar**: Prominent **`Call Next Customer (A014)`** button (`disabled` when waiting queue is empty).
- **Live Queue List**:
  - Sections for `Currently Serving (IN_SERVICE)`, `Called (CALLED)`, `Waiting Queue (WAITING — Strict FIFO Order)`, and collapsible `Recently Skipped` (with **`Re-queue`** action generating a new FIFO sequence).
  - Each card shows: Token number (`QR` or `Walk-In` source badge), Customer name, Mobile (`tel:` link), Requested services, Registration time, Estimated waiting time, Status badge, and permitted action buttons (`Start Service`, `Complete Service`, `Skip`, `Cancel`, `Mark No-Show`).

### 2.2 Branch Management (`/owner/branches`) & Services (`/owner/services`)
- **Branches**: Create branch modal (Name, Slug, City, Address, Timezone), edit 7-day `BusinessHours`, configure `activeStationsCount`, activate/deactivate branch.
- **Services**: Manage org-wide catalog (`Service`), plus branch matrix/drawer (`BranchService`) toggling branch availability and setting branch-specific price/duration overrides.

### 2.3 Staff & RBAC (`/owner/staff`)
- Table/cards of active members & pending invites, role assignment (`OWNER`, `MANAGER`, `STAFF`, or custom `StaffRole` permission matrix), branch assignment checkboxes (`All Branches` or specific branches), and `Revoke Access`.

### 2.4 QR Management (`/owner/qr`)
- High-contrast QR preview bound to `https://domain.com/salon/{slug}/{branch}` (plus optional `?t=` strict mode toggle).
- Actions: **Copy URL**, **Download PNG** (`1024x1024`), **Download Printable Poster (PNG/PDF-ready)**, **Print Standee** (`@media print`).

### 2.5 Settings & Notifications (`/owner/settings` & `/owner/settings/notifications`)
- Multi-device subscription manager (**Enable Push on This Device**, device list showing Browser/OS & last used, **Send Test Notification**, Revoke device).
- Branch/Org rules (`allowCustomerCancel`, `allowDuplicateActiveTokens`, customer push thresholds) & Event preferences (`NEW_TOKEN_CREATED`, `CUSTOMER_APPROACHING`, `CUSTOMER_CALLED`, `QUEUE_LONG_THRESHOLD`, `DELIVERY_FAILURE`).
- Delivery Attempts & Dead-Letter Log viewer with manual **Retry** button.

### 2.6 Analytics (`/owner/analytics`) & History (`/owner/history`)
- Date range selector (`Today`, `7 Days`, `30 Days`, `Custom`) + Branch filter (`All Branches` vs single branch).
- Charts & tables: Daily/Weekly/Monthly token volume trends, Most requested services, Average waiting time & service duration trends, Side-by-side Branch comparison table, and History ledger.

---

## 3. Platform Admin Console (`/admin/*`)
- **Platform Overview**: Total Organizations, Active Branches, Today's Platform Token Volume, Background Job Health (Pending / Retrying / Dead-Letter).
- **Tenants Directory**: Filterable table with `Activate` / `Suspend` toggle and audit trail (zero unrestricted customer PII exposure).
