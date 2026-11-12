# API Specification — Master Overview

## 1. Conventions & Performance Standards

- **Format**: JSON (`application/json`), except SSE (`text/event-stream`) and QR exports (`image/png`, `image/svg+xml`).
- **Validation**: Strict Zod schemas validate path params, query strings, and request bodies on every endpoint.
- **Latency SLOs**:
  - Public branch & token reads: `p95 < 80ms`
  - Owner FIFO mutations: `p95 < 100ms`
  - Atomic token creation: `p95 < 150ms`
- **Bandwidth & Caching**:
  - `GET /api/public/tokens/[publicId]` and `GET /api/owner/branches/[branchId]/queue` emit weak `ETag` headers and return `304 Not Modified` when `If-None-Match` matches.
  - Protected tenant endpoints emit `Cache-Control: no-store`.
  - List endpoints (`history`, `notifications`, `admin/tenants`) cap `limit <= 50` with indexed pagination.
- **Tenant Boundary**: Never trust client-supplied `organizationId`; resolve tenant from session or validated public slugs / `publicId`.

---

## 2. API Surface Directory

- **System & Internal**:
  - `GET /api/health` — Readiness check (`SELECT 1`).
  - `POST /api/internal/jobs/process` — Bearer `CRON_SECRET` protected job trigger.
- **Public Customer APIs** -> [`PUBLIC_CUSTOMER_APIS.md`](./PUBLIC_CUSTOMER_APIS.md)
- **Owner & Staff APIs** -> [`OWNER_APIS.md`](./OWNER_APIS.md)
- **Platform Admin APIs** -> [`PLATFORM_ADMIN_APIS.md`](./PLATFORM_ADMIN_APIS.md)
- **Authentication & RBAC** -> [`AUTHENTICATION.md`](./AUTHENTICATION.md), [`AUTHORIZATION.md`](./AUTHORIZATION.md)
- **Error Envelope & Codes** -> [`ERROR_HANDLING.md`](./ERROR_HANDLING.md)
