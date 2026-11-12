# Multi-Tenant Requirements

## 1. Tenancy Model

SalonFlow uses a **Shared Database, Shared Schema, Discriminator + Composite Key + RLS Defense-in-Depth** multi-tenant model.

### Hierarchy
```text
Platform
└── Organization (Tenant)
    ├── SalonSettings (org defaults / branch settings)
    ├── StaffRole + RolePermission
    ├── OrganizationMember (Owner / Staff -> StaffBranchAccess)
    ├── Service (Organization base catalog)
    └── Branch (1..N physical locations)
        ├── BusinessHours (7-day operating windows)
        ├── BranchService (Branch availability + price/duration overrides)
        ├── QueueCounter (per branch + businessDate)
        ├── Token + TokenService (strict FIFO queue per branch)
        ├── PushSubscription (owner/staff/customer devices)
        └── NotificationEvent / Notification / NotificationDelivery
```

---

## 2. Mandatory Multi-Tenant Requirements

1. **`MTR-01` (Zero Client-Trusted Tenant IDs)**: Authenticated endpoints MUST resolve `organizationId` solely from the verified server session (`session.activeOrganizationId`), never from request JSON body `organizationId` fields.
2. **`MTR-02` (Branch-Level Access Control)**: When an authenticated user requests branch operations (`/api/owner/branches/[branchId]/...`), the server MUST verify:
   - `branch.organizationId === session.activeOrganizationId`, AND
   - Either `member` has organization-wide branch access (`allBranches = true` / Owner) OR `StaffBranchAccess` links `(member.id, branchId)`.
3. **`MTR-03` (Public Tenant Resolution)**: Public endpoints resolve `(organization, branch)` via validated URL slugs (`/salon/{salonSlug}/{branchSlug}`) verifying `organization.status === 'ACTIVE'` and `branch.isActive === true`.
4. **`MTR-04` (Independent Branch Queues & Counters)**: `Branch A` and `Branch B` under the same `Organization` MUST maintain independent `QueueCounter` sequences (`A001` at both branches concurrently without collision) and isolated live queues.
5. **`MTR-05` (Composite Foreign Keys & RLS)**: Database schema MUST link tenant-owned tables with composite tenant keys where appropriate and evaluate/apply PostgreSQL Row-Level Security (`TENANT_ISOLATION.md`).
6. **`MTR-06` (Tenant-Scoped Analytics & Audit Logs)**: Every dashboard KPI, historical report, push delivery log, and `AuditLog` entry MUST be strictly scoped to `organizationId` (and `branchId` when branch-filtered).
7. **`MTR-07` (Suspended Tenant Enforcement)**: Suspending an `Organization` via Platform Admin immediately blocks public token creation on all its branches and prevents authenticated owner/staff mutations.

