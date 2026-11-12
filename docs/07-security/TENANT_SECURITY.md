# Tenant Security Architecture

## 1. Multi-Tenant Threat Vectors & Controls

1. **Client-Spoofed `organizationId` / `branchId`**:
   - **Rule**: Never accept `organizationId` from request payloads on tenant endpoints. Resolve `organizationId` exclusively from verified Auth.js session (`activeOrganizationId`) and validate `branchId` ownership & `StaffBranchAccess`.
2. **Cross-Tenant IDOR (Insecure Direct Object Reference)**:
   - Every owner/staff Prisma query runs inside `withTenantDb(organizationId, ...)` (setting PostgreSQL transaction-local `SET LOCAL app.current_organization_id`) AND explicitly includes `where: { organizationId, ... }`.
   - Cross-tenant resource lookups always return `404 RESOURCE_NOT_FOUND` (not `403`) to prevent existence probing.
3. **Branch-Level Privilege Escalation**:
   - Staff assigned solely to `Branch A` attempting to read or mutate `Branch B`'s queue, services, or push notifications receive `403 BRANCH_ACCESS_DENIED`.
   - Staff attempting to call `BRANCH_MANAGE`, `STAFF_MANAGE`, `SETTINGS_MANAGE`, or `ANALYTICS_VIEW` without matching `RolePermission` receive `403 FORBIDDEN`.
4. **Push Subscription Tenant Leakage**:
   - Customer push payloads contain ONLY their own token number and branch display name—never another customer's identity.
   - Revoking a staff member immediately invalidates active sessions (`sessionVersion++`) AND sets `isActive = false` on their `PushSubscription` rows so removed staff stop receiving new-customer push alerts instantaneously!
5. **Tenant Suspension Isolation**:
   - When Platform Admin suspends `Organization`, public branch QR pages immediately reject new token submissions (`403 TENANT_SUSPENDED`) and owner/staff API mutations are blocked.

