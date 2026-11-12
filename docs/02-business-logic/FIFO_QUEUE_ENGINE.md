# Strict FIFO Queue Engine

## 1. FIFO Principles (Section 6 Specification)

SalonFlow enforces a **strict First-In, First-Out (FIFO)** queue per `(organizationId, branchId, businessDate)`:
1. **Deterministic Ordering**: Waiting queue order is determined strictly by `sequenceNumber ASC` (assigned atomically inside the DB counter transaction—never unreliable client clocks).
2. **No Manual Reordering / No VIP Overrides in v1**: Staff cannot drag-and-drop tokens ahead of waiting customers or insert priority jumpers.
3. **Non-Blocking Departures**: `CANCELLED`, `SKIPPED`, and `NO_SHOW` tokens leave the active waiting pool immediately and never block subsequent customers.
4. **Called Priority Retention**: Once a token is `CALLED`, it retains its active priority while the customer walks to the chair (`CALLED` displays ahead of `WAITING` until marked `IN_SERVICE`, `SKIPPED`, `NO_SHOW`, or `CANCELLED`).

---

## 2. Active Queue Grouping per Branch & Business Date

- **`IN_SERVICE`**: Ordered by `serviceStartedAt ASC`.
- **`CALLED`**: Ordered by `calledAt ASC, sequenceNumber ASC`.
- **`WAITING`**: Ordered by `sequenceNumber ASC` (**Strict FIFO head = minimum `sequenceNumber`**).

---

## 3. Concurrency-Safe Operations

### A. `Call Next` (`POST /api/owner/branches/[branchId]/queue/call-next`)
Prevents two staff members tapping **"Call Next"** simultaneously from calling the same customer twice:
1. Verify tenant, branch access, and `QUEUE_CALL_NEXT` permission.
2. Execute inside `prisma.$transaction`:
   ```sql
   SELECT id
   FROM "tokens"
   WHERE "organization_id" = $1
     AND "branch_id" = $2
     AND "business_date" = $3::date
     AND "status" = 'WAITING'
   ORDER BY "sequence_number" ASC
   LIMIT 1
   FOR UPDATE SKIP LOCKED;
   ```
   - `FOR UPDATE SKIP LOCKED` ensures Worker A locks `A005` while concurrent Worker B skips the locked `A005` row and safely locks `A006` (or returns `409 NO_WAITING_CUSTOMERS` if none remain)!
3. Transition selected token `WAITING -> CALLED`, set `calledAt = NOW()`.
4. Emit outbox `NotificationEvent` (`TOKEN_CALLED` to customer if push-subscribed + `CUSTOMER_CALLED` optional owner log) + evaluate threshold notifications (`3 ahead`, `1 ahead`) for subsequent waiting tokens!
5. Write `AuditLog` (`TOKEN_CALLED`).

### B. Targeted Token Actions (`PATCH /api/owner/branches/[branchId]/tokens/[tokenId]/status`)
Actions: `START_SERVICE`, `COMPLETE`, `SKIP`, `CANCEL`, `MARK_NO_SHOW`.
1. Lock target row `SELECT ... FROM "tokens" WHERE id = $1 AND organization_id = $2 AND branch_id = $3 FOR UPDATE`.
2. Validate state machine guard (`ALLOWED_TRANSITIONS`). Return `409 INVALID_STATE_TRANSITION` if another staff action or customer cancel already changed the token's state.
3. Persist new status + timestamp + `AuditLog` + threshold `NotificationEvent`s (if queue advanced) atomically.
4. Post-commit: trigger outbox worker + single-pass SSE broadcast for that branch.

### C. Walk-In Manual Entry (`POST /api/owner/branches/[branchId]/tokens/walk-in`)
1. Requires authenticated member with `QUEUE_CREATE_WALKIN` (or `QUEUE_CALL_NEXT`) permission and branch access.
2. Invokes the **exact same `TokenService.createToken()` engine** with `source = 'WALK_IN'`: uses branch `QueueCounter`, enters strict FIFO queue, records `AuditLog` (`actorType = 'OWNER' | 'STAFF'`), and broadcasts SSE updates to `/owner/queue`.

### D. Skipped Customer Re-Queue (`POST /api/owner/branches/[branchId]/tokens/[tokenId]/requeue`)
1. Lock original token `FOR UPDATE`; verify `status === 'SKIPPED'` and `requeuedToTokenId IS NULL` (idempotent guard preventing double re-queue).
2. **Preserve original `SKIPPED` token untouched** in history (`createdAt`, `skippedAt`, original `sequenceNumber`).
3. Atomically increment branch `QueueCounter` inside the same transaction to generate a **new `sequenceNumber` & `tokenNumber`** at the back of the `WAITING` queue (`requeuedFromTokenId = original.id`).
4. Link `original.requeuedToTokenId = newToken.id`, write `AuditLog` (`TOKEN_REQUEUED`), emit `NotificationEvent` (`TOKEN_REQUEUED`), and broadcast SSE update.
5. Maintains 100% strict FIFO without mutating historical sequences.

