# Multi-Tenant Architecture

## 1. Tenant & Branch Model

SalonFlow isolates independent salon businesses (`Organization`) while allowing each business to operate `1..N` physical branches (`Branch`).

```text
Organization (Tenant: "aura-grooming")
├── OrganizationMember (Neha -> OWNER, allBranches: true)
├── OrganizationMember (Suresh -> STAFF, assignedBranches: [Koramangala])
├── StaffRole + RolePermission (Granular RBAC per Tenant)
├── Service (Org Catalog: Haircut ₹300, Facial ₹800)
├── Branch 1 ("koramangala")
│   ├── BusinessHours, SalonSettings
│   ├── BranchService (overrides/availability)
│   ├── Customers (branch-scoped customer records)
│   ├── QueueCounter (koramangala + 2026-11-10 -> A014)
│   ├── Token + TokenService (Independent FIFO Queue)
│   └── PushSubscription + Notifications
└── Branch 2 ("indiranagar")
    ├── BusinessHours, SalonSettings
    ├── BranchService
    ├── Customers (branch-scoped customer records)
    ├── QueueCounter (indiranagar + 2026-11-10 -> A003)
    └── Token + TokenService (Independent FIFO Queue)
```

---

## 2. Tenant Context Resolution Rules

1. **Authenticated Routes (`/api/owner/*`, `/owner/*`)**:
   - Session carries `userId` and `activeOrganizationId`.
   - `resolveTenantContext(branchId?)` loads active `OrganizationMember` (`status === 'ACTIVE'`), `Organization` (`status === 'ACTIVE'`), assigned `StaffRole` + `RolePermission[]`, and `StaffBranchAccess[]`.
   - **Never read `organizationId` from request body or query params.**
   - If a `branchId` is passed via route URL (`/branches/[branchId]/...`), verify `branch.organizationId === context.organizationId` AND `member.hasBranchAccess(branchId)`—returning `404` (never `403` on cross-tenant ID mismatch) to avoid tenant enumeration.
2. **Public Customer Routes (`/salon/[salonSlug]/[branchSlug]`)**:
   - Resolve `Organization` via unique `slug`, verify `organization.status === 'ACTIVE'`.
   - Resolve `Branch` via `(organizationId, branchSlug)`, verify `branch.isActive === true`.
3. **Public Token Routes (`/api/public/tokens/[publicId]`)**:
   - Lookup by cryptographic `publicId` (`UNIQUE`), extracting `(organizationId, branchId)` safely from the persisted token record—never allowing `publicId` to query sibling tokens or sibling tenants.
4. **Platform Admin Routes (`/api/admin/*`)**:
   - Require `User.isPlatformAdmin === true`. Operates across tenants ONLY on metadata, aggregated metrics, tenant activation/suspension, and non-PII diagnostic logs.

