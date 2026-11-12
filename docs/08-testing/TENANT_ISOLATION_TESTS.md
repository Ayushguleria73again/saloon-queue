# Tenant Isolation Test Cases (`TENANT_ISOLATION_TESTS.md`)

Executed against PostgreSQL using a **non-superuser application role** so both application guards and PostgreSQL RLS policies are rigorously tested.

---

## Test Matrix

- **`TI-01` (Cross-Tenant API Read/Write Block)**:
  - Authenticate as Owner of **Salon A**. Attempt:
    - `GET /api/owner/branches/[salonB_branchId]/queue`
    - `POST /api/owner/branches/[salonB_branchId]/queue/call-next`
    - `PATCH /api/owner/branches/[salonB_branchId]/tokens/[salonB_tokenId]/status`
    - `PATCH /api/owner/services/[salonB_serviceId]`
    - `GET /api/owner/analytics?branchId=[salonB_branchId]`
  - **Assert**: Every request returns `404` and Salon B's records remain completely unmodified.

- **`TI-02` (Client-Spoofed `organizationId` Ignored)**:
  - Owner of **Salon A** submits `POST /api/owner/services` or `POST /api/owner/branches` with `{ "organizationId": "<salonB_id>", ... }` in JSON body.
  - **Assert**: Server ignores body `organizationId`, binds strictly to Salon A from session (or rejects via Zod `.strict()`), and Salon B receives 0 rows.

- **`TI-03` (Branch-Level Staff Access Control)**:
  - Invite Staff member assigned ONLY to `Branch 1` of Salon A.
  - Attempt to read `GET /api/owner/branches/[branch2_id]/queue` or call `Call Next` on `Branch 2`.
  - **Assert**: Returns `403 BRANCH_ACCESS_DENIED`; `Branch 2` push subscriptions never deliver to this staff member.

- **`TI-04` (Customer Cross-Branch Service Injection)**:
  - Customer posts to `/api/public/salons/salon-a/branch-1/tokens` passing a `serviceId` belonging to `Salon B` or `Branch 2` (or deactivated at `Branch 1`).
  - **Assert**: Rejected with `422 SERVICE_UNAVAILABLE` / `404`.

- **`TI-05` (PostgreSQL RLS Direct Verification)**:
  - Execute a test query intentionally missing `WHERE organization_id = ...` inside `withTenantDb(salonA.id, ...)`.
  - **Assert**: PostgreSQL RLS policy returns **only** Salon A rows and zero Salon B rows; attempting `INSERT` with `organization_id = salonB.id` inside `salonA` context raises PostgreSQL RLS violation (`42501`)!

- **`TI-06` (Customer Public Token Isolation)**:
  - Customer with `publicId_1` tries querying `/api/public/tokens/[publicId_1]` or subscribing push to `publicId_2` guessed/invalid.
  - **Assert**: Zero access to any other customer's name, phone, token number, or push subscription.

- **`TI-07` (Branch-Scoped Customer & Queue Isolation)**:
  - Staff assigned only to `Branch 1` attempts to look up customers or token history belonging to `Branch 2` in the same `Organization`.
  - **Assert**: Rejected (`403 BRANCH_ACCESS_DENIED`); `Branch 1` and `Branch 2` maintain isolated `Customer`, `QueueCounter`, and `Token` records.

