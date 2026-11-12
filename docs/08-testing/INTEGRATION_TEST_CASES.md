# Integration Test Cases

Executed against real PostgreSQL test DB with Prisma migrations & RLS enabled.

## 1. Multi-Branch & Onboarding
- `IT-ONB-01`: `POST /api/auth/register-salon` creates `User`, `Organization`, default `StaffRole`s + `RolePermission`s, `OrganizationMember`, initial `Branch`, 7 `BusinessHours`, `SalonSettings`, and `AuditLog` atomically.
- `IT-BRN-01`: Two branches (`main` and `west`) under the same `Organization` both generate independent `A001`, `A002` tokens on the same `businessDate` without conflict.
- `IT-BRN-02`: Editing `BranchService` price/availability at Branch A does not alter Branch B or organization base price, and never alters existing `TokenService` snapshots.

## 2. Public Intake, Walk-In, Self-Cancel & Re-queue
- `IT-PUB-01`: `POST /tokens` rejects inactive/unavailable `BranchService` IDs (`422 SERVICE_UNAVAILABLE`) or services from another branch/tenant.
- `IT-PUB-02`: Duplicate active token at the same branch blocked cleanly (`409 ACTIVE_TOKEN_EXISTS`) without exposing existing `publicId` or token number; duplicate at Branch B while active at Branch A succeeds (queues are branch-independent).
- `IT-PUB-03`: `GET /api/public/tokens/[publicId]` returns `200` on initial fetch and `304 Not Modified` when `If-None-Match` matches `ETag`; raw customer mobile is omitted/masked (`******3210`) and sibling customers' data is absent.
- `IT-PUB-04`: Customer permission denial / missing subscription leaves token fully functional.
- `IT-PUB-05` (Customer Self-Cancellation Policy): Self-cancel succeeds (`200`) and writes `AuditLog` when status is `WAITING` and branch `allowCustomerCancel = true`; fails (`409`) once status is `CALLED` or `IN_SERVICE`, or (`403`) when branch setting is `false`.
- `IT-QUE-01` (Walk-In Manual Entry): `POST /api/owner/branches/[branchId]/tokens/walk-in` creates token with `source = 'WALK_IN'`, consumes branch `QueueCounter`, enters strict FIFO queue, and emits SSE + `AuditLog`.
- `IT-QUE-02` (Skipped Re-queue): `POST .../requeue` on `SKIPPED` `A002` keeps `A002` immutable in `SKIPPED`, generates new sequence (`A005`) at back of `WAITING`, records `TOKEN_REQUEUED` `AuditLog`, and preserves strict FIFO.

## 3. RBAC & Platform Admin
- `IT-RBAC-01`: Staff role with queue permissions can `Call Next`, `Start`, `Complete`, `Skip`, `Cancel`, `No-Show`, and receives `403 FORBIDDEN` on `/api/owner/staff`, `/api/owner/branches`, `/api/owner/settings`, `/api/owner/analytics`.
- `IT-ADM-01`: Platform Admin suspending an `Organization` blocks public token intake on all its branches (`403 TENANT_SUSPENDED`).
- `IT-ADM-02`: Platform Admin overview/tenant/job endpoints never return raw customer names or mobile numbers.

## 4. Analytics Accuracy
- `IT-ANA-01`: Tenant analytics accurately computes daily/weekly/monthly token counts, top requested services, avg wait, avg service duration, and multi-branch comparison scoped strictly to `organizationId`.
