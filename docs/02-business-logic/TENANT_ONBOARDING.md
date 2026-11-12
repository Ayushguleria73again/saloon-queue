# Tenant & Branch Onboarding Logic

## 1. Salon Business Self-Registration (`/register`)

A new salon owner onboards via a single atomic registration transaction:
1. Validate owner profile (`name`, `email`, strong `password`), `organizationName`, requested `salonSlug` (normalized lowercase kebab-case, globally unique), and first `branchName` (default `"Main Branch"`, `branchSlug = "main"`), `city`, `timezone` (`Asia/Kolkata`).
2. Inside `prisma.$transaction`:
   - Create `User` (password hashed with Argon2id/bcrypt).
   - Create `Organization` (`status = 'ACTIVE'` by default, or `'PENDING'` if `REQUIRE_ADMIN_TENANT_APPROVAL=true` per `ADR-011`).
   - Seed default `StaffRole`s for the tenant (`OWNER` with all permissions, `MANAGER`, `STAFF` with branch queue permissions) + `RolePermission` rows.
   - Create `OrganizationMember` linking `User` as `OWNER` (`allBranches = true`).
   - Create default `SalonSettings` for the organization.
   - Create initial `Branch` with unique `qrToken` + default 7-day `BusinessHours` (`09:30`–`21:30`).
   - Append `AuditLog` (`ORGANIZATION_REGISTERED`).
3. Sign owner in cleanly and direct to `/owner/dashboard` with a crisp onboarding checklist (Add Services -> Test Web Push -> Print Branch QR Poster).

---

## 2. Multi-Branch Expansion Flow

Inside `/owner/branches`, an authorized `OWNER` (or member with `BRANCH_MANAGE` permission) can:
1. **Create Branch**: Specify `name`, unique `branchSlug` (unique per `organizationId`), `address`, `city`, `phone`, `timezone`.
   - Automatically initializes 7-day `BusinessHours`, branch `SalonSettings` overrides (if branch-level overrides exist or inheriting org defaults), cryptographic `qrToken`, and inherits active `Service` catalog entries as `BranchService` rows (`isAvailable = true` or configurable).
2. **Edit / Activate / Deactivate Branch**:
   - Deactivating a branch immediately stops new customer QR intake on `/salon/{salonSlug}/{branchSlug}` while preserving historical tokens and analytics.

---

## 3. Staff Invitation & Branch Assignment

1. Owner opens `/owner/staff` -> clicks **"Invite Staff"**: enters staff `email`, `name`, `roleId`, and `allBranches` vs specific `branchIds[]`.
2. Creates a time-limited (`48h`), cryptographically random invitation token (`StaffInvitation` or `OrganizationMember` `INVITED` state + hashed token).
3. Staff clicks invite link (`/invite/{token}`), sets their password (or links existing `User` account), activating their `OrganizationMember` membership (`ACTIVE`) and `StaffBranchAccess` rows.
4. Revoking access updates `OrganizationMember.status = 'REVOKED'` and increments `User.sessionVersion`, locking out active sessions immediately.

