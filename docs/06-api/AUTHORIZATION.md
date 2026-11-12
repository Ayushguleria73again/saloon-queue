# Authorization & RBAC Specification

## 1. Role Hierarchy

1. **Platform Administrator (`User.isPlatformAdmin === true`)**:
   - Can access `/admin/*` and `/api/admin/*`.
   - Cannot enter arbitrary tenant queues or read customer personal data without tenant membership/audited diagnostic scope.
2. **Organization Member (`OWNER`, `MANAGER`, `STAFF`, or custom `StaffRole`)**:
   - Scoped to `session.activeOrganizationId`.
   - Evaluated via **`RolePermission`** keys + **`StaffBranchAccess`**.

---

## 2. Canonical Permission Keys (`RolePermission.permissionKey`)

| Permission Key | Default `OWNER` | Default `MANAGER` | Default `STAFF` |
| :--- | :---: | :---: | :---: |
| `QUEUE_VIEW` | ✅ | ✅ | ✅ |
| `QUEUE_CREATE_WALKIN` | ✅ | ✅ | ✅ |
| `QUEUE_CALL_NEXT` | ✅ | ✅ | ✅ |
| `QUEUE_START` | ✅ | ✅ | ✅ |
| `QUEUE_COMPLETE` | ✅ | ✅ | ✅ |
| `QUEUE_SKIP` | ✅ | ✅ | ✅ |
| `QUEUE_CANCEL` | ✅ | ✅ | ✅ |
| `QUEUE_NO_SHOW` | ✅ | ✅ | ✅ |
| `HISTORY_VIEW` | ✅ | ✅ | ✅ (assigned branch) |
| `QR_MANAGE` | ✅ | ✅ | ❌ |
| `SERVICE_MANAGE` | ✅ | ✅ | ❌ |
| `BRANCH_MANAGE` | ✅ | ❌ | ❌ |
| `STAFF_MANAGE` | ✅ | ❌ | ❌ |
| `SETTINGS_MANAGE` | ✅ | ❌ | ❌ |
| `ANALYTICS_VIEW` | ✅ | ✅ | ❌ |

---

## 3. Enforcement Pipeline (`authorizeTenantAction`)

Every `/api/owner/*` handler begins with:
```typescript
const ctx = await authorizeTenantAction({
  requiredPermission: 'QUEUE_CALL_NEXT',
  branchId: params.branchId, // verified against ctx.organizationId & StaffBranchAccess
});
```
1. Checks valid authenticated session + `sessionVersion` parity.
2. Checks `Organization.status === 'ACTIVE'` (blocks suspended tenants with `403 TENANT_SUSPENDED`).
3. Checks `OrganizationMember.status === 'ACTIVE'`.
4. Checks `ctx.permissions.has(requiredPermission)` (`403 FORBIDDEN` if lacking).
5. If `branchId` supplied: verifies `Branch.organizationId === ctx.organizationId` AND (`member.allBranches || allowedBranchIds.has(branchId)`). Cross-tenant IDs return `404` to block tenant enumeration; unassigned branch within same org returns `403 BRANCH_ACCESS_DENIED`.

