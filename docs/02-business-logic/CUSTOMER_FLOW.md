# Customer Flow Logic

## 1. End-to-End Customer Journey (< 30 Seconds)

```text
[Scan Branch QR Poster]
         │
         ▼
GET /salon/{salon-slug}/{branch-slug}?t={qrToken}
         │
         ├── Org suspended/missing or Branch inactive ──► [Friendly Unavailable Page / 404]
         ├── Strict QR mode & ?t invalid ───────────────► [Scan Official Branch QR Prompt]
         ├── Branch Closed / Outside BusinessHours / Paused ─► [Closed Notice + Branch Hours]
         ▼
[Show Salon Name, Branch Name, Live Wait Summary & Available BranchServices]
         │
         ▼
[Enter Name + 10-Digit Indian Mobile + Multi-Select Services + Optional Instructions]
         │
         ▼
POST /api/public/salons/{salon-slug}/{branch-slug}/tokens (with idempotencyKey)
         │
         ├── Rate Limit Exceeded / Bot Trap ────────────► [429 Retry Notice]
         ├── Validation Error / Unavailable Service ────► [400 / 422 Inline Errors]
         ├── Idempotency Key Matches Existing ──────────► [200 Existing Token Redirect]
         ├── Duplicate Active Token at Branch ──────────► [409 Safe Conflict (No PII Leak)]
         ▼
[ACID Transaction: QueueCounter + Customer + Token + TokenService + Outbox + AuditLog]
         │
         ├──► Trigger Async Outbox Worker (Owner Web Push) + SSE Broadcast
         ▼
Redirect ─► GET /salon/{salon-slug}/{branch-slug}/token/{publicId}
         │
         ▼
[Confirmation Screen: Token A014, Position, Est. Wait, Required Copy, Live SSE Updates]
         │
         └──► Optional User-Initiated Card: "Enable Browser Push Notifications"
                ├── User clicks Enable -> Request Permission -> Register SW -> Save Token-Scoped PushSubscription
                └── User declines/ignores -> Ticket updates live via SSE/Polling cleanly
```

---

## 2. Step-by-Step Validation & Rules

1. **Tenant & Branch Resolution**:
   - Look up `Organization` by `salonSlug` and `Branch` by `(organizationId, branchSlug)`.
   - Verify `organization.status === 'ACTIVE'` and `branch.isActive === true`.
2. **Branch Intake Eligibility**:
   - Verify `settings.isAcceptingTokens === true`.
   - If `settings.enforceBusinessHours === true`, validate current branch-local time (using `branch.timezone`) falls inside today's open `BusinessHours`.
3. **Input Validation & Service Availability**:
   - `fullName`: trimmed, 2–80 chars.
   - `mobileNumber`: normalized Indian 10-digit mobile (`^[6-9]\d{9}$`).
   - `serviceIds`: 1–15 unique IDs; verify EVERY selected service belongs to `(organizationId, branchId)` via `BranchService` where `Service.isActive = true` and `BranchService.isAvailable = true`. Reject inactive/cross-branch/cross-tenant services (`422 SERVICE_UNAVAILABLE`).
   - `notes`: optional max 300 chars.
   - `honeypot` field (hidden bot trap): must be empty; optionally support turnstile/bot check hook in Phase 16.
4. **Duplicate Active Token Guard**:
   - Inside transaction with `pg_advisory_xact_lock` on `(branchId, normalizedMobile)`: if `settings.allowDuplicateActiveTokens === false`, reject if `(branchId, customerId)` already holds a token in `['WAITING', 'CALLED', 'IN_SERVICE']` (returning `409 ACTIVE_TOKEN_EXISTS` with zero leaked PII).
5. **Confirmation Screen & Self-Cancel Rules**:
   - Required copy:
     - `"Your token has been generated successfully!"`
     - `"Please wait for your turn. We will notify you when your turn is approaching."`
   - Never display raw mobile number or other customers' data on `/token/{publicId}`.
   - **Self-Cancellation**: Customer may cancel **ONLY while status is `WAITING`** (and only if branch `SalonSettings.allowCustomerCancel === true`); self-cancellation is disabled once `CALLED` or `IN_SERVICE`, and every cancellation is logged in `AuditLog`.
   - **Re-queued Notice**: If a previously `SKIPPED` token was re-queued by staff (`requeuedToTokenId` present), display a clear banner linking directly to the customer's new FIFO token (`/token/{newPublicId}`).
