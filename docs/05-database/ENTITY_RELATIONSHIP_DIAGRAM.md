# Entity Relationship Diagram — SalonFlow SaaS

```mermaid
erDiagram
    User ||--o{ OrganizationMember : "joins"
    User ||--o{ PushSubscription : "subscribes_devices"
    Organization ||--o{ OrganizationMember : "employs"
    Organization ||--o{ StaffRole : "defines"
    StaffRole ||--o{ RolePermission : "grants"
    StaffRole ||--o{ OrganizationMember : "assigned_to"
    OrganizationMember ||--o{ StaffBranchAccess : "scoped_to"
    Branch ||--o{ StaffBranchAccess : "permits"

    Organization ||--o{ Branch : "operates"
    Organization ||--o{ Service : "catalogs"
    Organization ||--o{ SalonSettings : "configures"
    Organization ||--o{ AuditLog : "audits"

    Branch ||--o{ SalonSettings : "overrides"
    Branch ||--o{ BusinessHours : "schedules"
    Branch ||--o{ BranchService : "offers"
    Service ||--o{ BranchService : "customized_per"
    Branch ||--o{ Customer : "serves"
    Branch ||--o{ QueueCounter : "sequences"
    Branch ||--o{ Token : "issues"

    Customer ||--o{ Token : "holds"
    Token ||--|{ TokenService : "snapshots"
    Service ||--o{ TokenService : "referenced_in"
    Token ||--o{ PushSubscription : "notifies_via"

    Organization ||--o{ NotificationEvent : "outbox"
    Token ||--o{ NotificationEvent : "triggers"
    NotificationEvent ||--o{ Notification : "fans_out"
    PushSubscription ||--o{ Notification : "receives"
    Notification ||--o{ NotificationDelivery : "logs_attempts"
```

---

## Composite Tenant Key Guarantees

Every tenant-owned child entity embeds `organizationId` in its foreign key relationship to parent entities:
- `(organizationId, branchId)` -> `Branch(organizationId, id)`
- `(organizationId, memberId)` -> `OrganizationMember(organizationId, id)`
- `(organizationId, serviceId)` -> `Service(organizationId, id)`
- `(organizationId, branchId, customerId)` -> `Customer(organizationId, branchId, id)`
- `(organizationId, tokenId)` -> `Token(organizationId, id)`
- `(organizationId, notificationEventId)` -> `NotificationEvent(organizationId, id)`
- `(organizationId, notificationId)` -> `Notification(organizationId, id)`

This makes cross-tenant relational corruption (e.g., linking Salon A's token to Salon B's customer or branch) structurally impossible inside PostgreSQL.
