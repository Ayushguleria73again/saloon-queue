# Owner & Staff APIs

All endpoints require an authenticated `User` session (`authorizeTenantAction()`), enforce `RolePermission` + branch access, and emit `Cache-Control: no-store`.

---

## 1. Branch & Settings Management
- `GET /api/owner/branches` — List branches accessible to current user (`allBranches` or `StaffBranchAccess`).
- `POST /api/owner/branches` (`BRANCH_MANAGE`) — Create branch + initial `BusinessHours` + `BranchService` links + `qrToken`.
- `PATCH /api/owner/branches/[branchId]` (`BRANCH_MANAGE`) — Update details, timezone, active status, `BusinessHours`, and branch `SalonSettings`.
- `GET /api/owner/settings` (`SETTINGS_MANAGE`) — Organization defaults (`SalonSettings`).
- `PATCH /api/owner/settings` (`SETTINGS_MANAGE`) — Update org settings.

---

## 2. Services & Branch Overrides (`SERVICE_MANAGE`)
- `GET /api/owner/services` — List org catalog + branch override matrix.
- `POST /api/owner/services` — Create service (`basePriceInPaise`, `baseDurationMinutes`).
- `PATCH /api/owner/services/[serviceId]` — Update or soft-deactivate (`isActive = false`).
- `PUT /api/owner/branches/[branchId]/services/[serviceId]` — Configure `BranchService` (`isAvailable`, `priceOverrideInPaise`, `durationOverrideMinutes`).

---

## 3. Staff & RBAC Management (`STAFF_MANAGE`)
- `GET /api/owner/staff` — List `OrganizationMember`s, pending invites, `StaffRole`s, and branch assignments.
- `POST /api/owner/staff/invite` — Send/create staff invitation (`email`, `roleId`, `allBranches`, `branchIds[]`).
- `PATCH /api/owner/staff/[memberId]` — Update role, branch assignments, or suspend/reactivate.
- `DELETE /api/owner/staff/[memberId]` — Revoke member (`status = 'REVOKED'`, increments `sessionVersion`, deactivates push subscriptions).
- `GET|POST|PATCH /api/owner/roles` — View or customize `StaffRole`s & `RolePermission` keys.

---

## 4. Branch Live FIFO Queue (`QUEUE_*` permissions + Branch access)
- `GET /api/owner/branches/[branchId]/queue` — Returns 7 Overview KPIs + active FIFO queue (`IN_SERVICE`, `CALLED`, `WAITING`) + today's `SKIPPED` list + estimated wait times (`ETag`/`304` supported).
- `GET /api/owner/branches/[branchId]/queue/events` — SSE stream for branch live updates.
- `POST /api/owner/branches/[branchId]/tokens/walk-in` (`QUEUE_CREATE_WALKIN` / `QUEUE_CALL_NEXT`) — Manual walk-in token registration using `TokenService.createToken()` (`source = 'WALK_IN'`), incrementing branch `QueueCounter`, entering strict FIFO queue, and publishing SSE update.
- `POST /api/owner/branches/[branchId]/queue/call-next` (`QUEUE_CALL_NEXT`) — Strict FIFO atomic `Call Next` (`FOR UPDATE SKIP LOCKED`).
- `PATCH /api/owner/branches/[branchId]/tokens/[tokenId]/status` — Transitions: `START_SERVICE`, `COMPLETE`, `SKIP`, `CANCEL`, `MARK_NO_SHOW`.
- `POST /api/owner/branches/[branchId]/tokens/[tokenId]/requeue` (`QUEUE_CALL_NEXT`) — Re-queues a `SKIPPED` token by preserving the original token in history and atomically issuing a new sequence at the back of `WAITING` (`TOKEN_REQUEUED` audit & push event).
- `GET /api/owner/branches/[branchId]/history` (`HISTORY_VIEW`) — Paginated (`limit <= 50`) historical ledger with date/status/search filters.

---

## 5. QR, Analytics & Owner Push
- `GET /api/owner/branches/[branchId]/qr` (`QR_MANAGE`) — `?format=json|png|svg` + printable poster metadata.
- `POST /api/owner/branches/[branchId]/qr/regenerate` (`QR_MANAGE`) — Rotate `Branch.qrToken`.
- `GET /api/owner/analytics` (`ANALYTICS_VIEW`) — Query `?from=...&to=...&branchId=...`: daily/weekly/monthly trends, most requested services, avg wait & service duration, cross-branch comparisons.
- `GET|POST|DELETE /api/owner/push-subscriptions` — Manage user's multi-device Web Push subscriptions.
- `POST /api/owner/push-subscriptions/test` — Enqueue immediate test Web Push to current user's active device(s).
- `GET /api/owner/notifications` — Paginated recent push notifications & delivery attempt statuses + `POST /api/owner/notifications/[id]/retry`.

