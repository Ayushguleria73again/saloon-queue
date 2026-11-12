# Database Indexing & Query Optimization Strategy

## 1. High-Priority Indexes

### Multi-Tenant Lookup & Auth
- `organizations`: `UNIQUE (slug)`
- `branches`: `UNIQUE (organization_id, slug)`, `INDEX (organization_id, is_active)`
- `users`: `UNIQUE (email)`
- `organization_members`: `UNIQUE (organization_id, user_id)`, `INDEX (user_id, status)`
- `staff_branch_access`: `UNIQUE (member_id, branch_id)`

### Branch Catalog, Customers & Config
- `customers`: `UNIQUE (branch_id, mobile_number)`, `UNIQUE (organization_id, branch_id, id)`
- `services`: `INDEX (organization_id, is_active, sort_order)`
- `branch_services`: `UNIQUE (branch_id, service_id)`, `INDEX (branch_id, is_available, sort_order)`
- `business_hours`: `UNIQUE (branch_id, day_of_week)`

### FIFO Queue & Token Engine (`tokens` & `queue_counters`)
- `queue_counters`: `UNIQUE (branch_id, business_date, prefix)`
- `tokens`:
  - `UNIQUE (public_id)` — Public status & SSE lookups (`O(1)`)
  - `UNIQUE (branch_id, business_date, sequence_number)` — Enforces strict FIFO uniqueness
  - `UNIQUE (branch_id, business_date, token_number)`
  - Partial `UNIQUE (branch_id, idempotency_key) WHERE idempotency_key IS NOT NULL`
  - **`INDEX (organization_id, branch_id, business_date, status, sequence_number)`** — **Critical Active Queue & KPI Covering Path**: powers `Call Next`, live FIFO listing, WaitTime projection, and single-query KPI aggregations!
  - `INDEX (branch_id, customer_id, status)` — Fast duplicate-active-token check.
  - `INDEX (organization_id, branch_id, created_at DESC, id DESC)` — Keyset/cursor pagination for branch history & analytics.
- `token_services`: `INDEX (token_id)`, `INDEX (organization_id, service_id)` (for top requested services analytics).

### Outbox, Push, Settings & Audit
- `salon_settings`: Partial `UNIQUE (organization_id) WHERE branch_id IS NULL` (`salon_settings_org_default_unique`) + `UNIQUE (organization_id, branch_id)`.
- `push_subscriptions`:
  - Partial `UNIQUE (user_id, endpoint) WHERE user_id IS NOT NULL` (`push_subscriptions_user_endpoint_unique`).
  - Partial `UNIQUE (token_id, endpoint) WHERE token_id IS NOT NULL` (`push_subscriptions_token_endpoint_unique`).
  - `INDEX (organization_id, subscriber_type, is_active, branch_id)` — Fast owner/staff device resolution on new token!
  - `INDEX (token_id, is_active)` — Fast customer push lookup on turn milestones.
- `notification_events`:
  - `UNIQUE (organization_id, idempotency_key)` — Guarantees zero duplicate milestone alerts!
  - Partial `INDEX (status, next_attempt_at, locked_until) WHERE status IN ('PENDING', 'RETRYING', 'PROCESSING')` (`notification_events_outbox_due_idx`) — Tiny, blazing-fast index for worker `SKIP LOCKED` claims!
- `notifications`: `INDEX (organization_id, created_at DESC)`
- `notification_deliveries`: `INDEX (notification_id, attempt_number)`
- `audit_logs`: `INDEX (organization_id, created_at DESC)`, `INDEX (entity_type, entity_id, created_at DESC)`

---

## 2. Query Optimization Rules
- Single SQL conditional aggregation for all 7 Overview KPIs (`COUNT(*) FILTER`, `AVG(...) FILTER`).
- Explicit `select` lists to skip unneeded `TEXT`/`JSONB` blobs on high-QPS endpoints.
- Prisma `directUrl = env("DIRECT_URL")` for migrations and `LISTEN/NOTIFY`; `DATABASE_URL` for pooled runtime queries.
