---
name: surgical-bug-hunt
description: >-
  Systematic whole-feature diagnostic and surgical bug-fixing workflow. Compares actual
  code behavior against documented SalonFlow specs, traces full vertical slices, writes a
  reproducing test, applies the smallest targeted fix, and verifies without collateral churn.
---

# Surgical Feature Bug Hunt Skill

Use this workflow whenever auditing a feature, investigating unexpected behavior, or verifying correctness end-to-end.

## Step 1: Establish Expected Behavior (Docs First)
Read the exact governing specifications before inspecting code:
- Business rules: `docs/02-business-logic/` (`CUSTOMER_FLOW.md`, `FIFO_QUEUE_ENGINE.md`, `QUEUE_STATUS_TRANSITIONS.md`, etc.)
- API & Auth contracts: `docs/06-api/` (`ERROR_HANDLING.md`, `AUTHORIZATION.md`, endpoint specs)
- Security & Tenant Isolation: `docs/07-security/` & `docs/05-database/TENANT_ISOLATION.md`

## Step 2: Trace the Full Vertical Slice (Actual Behavior)
Trace every hop from trigger to persistence and feedback:
1. **UI / Form / Hook**: Payload shape, `idempotencyKey`, error display, `EventSource` cleanup, re-sync on `visibilitychange` / `online`.
2. **Route Handler / Action**: Auth guard, `authorizeTenantAction(permission, branchId)`, Zod schema validation, HTTP status mapping.
3. **Domain Service**: Business rules, state transition matrix, `organizationId` / `branchId` scoping, non-blocking side effects post-commit.
4. **Database / Transaction**: `withTenantDb` RLS context, `FOR UPDATE` / `SKIP LOCKED` / `pg_advisory_xact_lock`, composite FKs, snapshot integrity.
5. **Async Outbox & SSE**: Idempotency keys, `404`/`410` push cleanup, single-pass SSE projection, no PII leakage.

## Step 3: Check High-Risk SalonFlow Invariants
- Can Tenant A read/mutate Tenant B data or spoof `organizationId`?
- Can Staff assigned to Branch 1 touch Branch 2?
- Can concurrent `Call Next` or concurrent token submissions collide or corrupt FIFO `sequenceNumber`?
- Is customer self-cancellation strictly blocked once `CALLED` or `IN_SERVICE`?
- Does re-queuing a `SKIPPED` token preserve original history and generate a new tail sequence?
- Does push failure ever abort token creation?
- Are raw customer mobile numbers hidden on public `/token/[publicId]` and redacted in Platform Admin APIs?

## Step 4: Reproduce -> Surgical Fix -> Verify
1. **Reproduce First**: Write a focused failing Vitest (or Playwright) regression test demonstrating the exact discrepancy between expected and actual behavior.
2. **Surgical Fix Only**: Patch ONLY the root cause inside the relevant module—never refactor unrelated files or silence errors with `any`/try-catch swallowing.
3. **Verify**:
   - Confirm the new regression test passes.
   - Run `npm run typecheck`, `npm run lint`, and the affected unit/integration/concurrency test suites.
   - Document the fix in `CHANGELOG.md` if behavioral or architectural.

