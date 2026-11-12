# User Flows — SalonFlow SaaS

## 1. Customer Flow: Branch QR -> Token -> Optional Web Push

```text
[Physical Branch QR Poster]
        │
        ▼
/salon/{salon-slug}/{branch-slug}
  - Salon & Branch Name + Open/Closed Status
  - Live Wait Snapshot ("4 waiting • ~25m approx.")
  - Intake Form: Name + 10-digit Mobile + Branch Services + Notes
        │ (Tap "Get Queue Token" < 30s)
        ▼
/salon/{salon-slug}/{branch-slug}/token/{publicId}
  - "Your token has been generated successfully!"
  - "Please wait for your turn. We will notify you when your turn is approaching."
  - Large Token: A014 | Position: #3 | Approx Wait: ~20 mins
  - Live auto-updating status (SSE + ETag polling fallback)
  - Optional Opt-In Card: [Enable Browser Push Alerts]
        ├── Granted -> SW registered -> Subscribed to 3-ahead, 1-ahead, Called
        └── Declined / iOS Non-PWA -> Works normally via live status screen
```

---

## 2. Salon Owner Flow: SaaS Onboarding -> Operations

```text
/register (Salon Name, Slug, Owner Email/Pass, First Branch)
        │
        ▼
/owner/dashboard (Branch Switcher in Header)
  ├── /owner/branches               -> Add/edit branches, hours, stations, QR
  ├── /owner/services               -> Create base services & branch availability/price overrides
  ├── /owner/staff                  -> Invite staff, assign StaffRole + specific branches
  ├── /owner/settings               -> Queue rules + Enable multi-device Web Push + Test Push + Logs
  └── /owner/queue                  -> Live FIFO Queue Console (+ Add Walk-In):
        [Call Next] -> [Start Service] -> [Complete Service] (or [Skip]->[Re-queue] / [Cancel] / [No-Show])
```

---

## 3. Salon Staff Flow (Branch-Scoped)

```text
/invite/{token} (Accept invite & set password) -> /login
        │
        ▼
/owner/queue (scoped to assigned branchId)
  - Sees ONLY assigned branch(es) and permitted actions
  - Receives Web Push on new token arrivals for assigned branch
  - Operates FIFO queue (Call Next, Add Walk-In, Start, Complete, Skip, Re-queue, Cancel, No-Show)
```

---

## 4. Platform Administrator Flow

```text
/login -> /admin
  ├── /admin/tenants     -> Search organizations, inspect usage, Activate / Suspend tenant
  ├── /admin/jobs        -> Monitor background outbox queue & push failure rates
  └── /admin/health      -> DB health, API latency, system diagnostics (Customer PII masked)
```
