# SalonFlow — Multi-Tenant Salon Queue Management SaaS

**SalonFlow** is a production-ready, multi-tenant Software-as-a-Service (SaaS) platform that enables independent salon businesses and multi-branch chains to digitize walk-in queues using branch-specific QR codes, strict FIFO token engines, live real-time status tracking, and Web Push notifications via Service Workers.

---

## Core Capabilities

### 1. Multi-Tenant Organization & Branch Architecture
- **Tenant Isolation**: Every salon business (`Organization`) operates as an isolated tenant with strict server-side tenant resolution, composite foreign keys, and defense-in-depth PostgreSQL Row-Level Security (RLS) support.
- **Multi-Branch Ready**: One organization can manage one or multiple physical branches (`Branch`), each with independent queues, daily token counters, QR codes, business hours, service overrides, and staff assignments.
- **RBAC**: Platform Administrators, Salon Owners, and permission-scoped Salon Staff (`StaffRole` & `RolePermission`).

### 2. Zero-Friction Customer Experience (`/salon/{salon-slug}/{branch-slug}`)
- **No App or Login Required**: Scan the branch QR poster, enter name + 10-digit Indian mobile number, select available branch services, and submit.
- **Atomic Daily FIFO Tokens**: Branch-scoped daily tokens (`A001`, `A002`, ...) generated inside ACID PostgreSQL transactions with atomic counters.
- **Live Status & Optional Web Push**: Track queue position and estimated wait time at an unguessable URL (`/salon/{salon-slug}/{branch-slug}/token/{publicId}`) with optional user-initiated browser push notifications (`3 ahead`, `1 ahead`, `called`).

### 3. Salon Owner & Staff Operations Dashboard
- **Live Queue Console**: One-tap strict FIFO progression (`Call Next`, `Start Service`, `Complete Service`, `Skip Customer`, `Cancel Token`, `Mark No-Show`).
- **Multi-Device Owner Web Push**: Instant browser/PWA alerts on phones, tablets, and desktops via VAPID + Service Workers.
- **Branch, Service, Staff & QR Management**: Configure branches, per-branch pricing/availability, staff roles, printable QR standees, and daily/weekly/monthly branch analytics.

---

## Technology Stack

| Layer | Technology | Rationale |
| :--- | :--- | :--- |
| **Architecture** | Modular Monolith (No Turborepo / Microservices) | Single deployable unit with strict internal module boundaries |
| **Frontend & Backend** | Next.js App Router, React, TypeScript | SSR + Route Handlers + Server Actions in strict TypeScript |
| **Styling & Motion** | Tailwind CSS, Framer Motion, Lucide React | Mobile-first responsive SaaS UI |
| **Database & ORM** | PostgreSQL 16+ & Prisma ORM | ACID transactions, composite FKs, RLS defense-in-depth |
| **Notifications** | Web Push API + Service Workers + VAPID + Outbox Jobs | Native browser push for owners, staff, and opt-in customers |
| **Real-Time** | Server-Sent Events (SSE) + Smart Polling Fallback | Instant live dashboard & ticket updates (`ETag`/`304` fallback) |
| **Authentication** | Established Session Auth (Auth.js v5) + RBAC | Secure HTTP-only sessions, tenant/branch claims, lockout protection |

---

## Documentation Structure

All architecture and requirements live in `docs/`:

- [`docs/01-product/`](./docs/01-product/PRODUCT_VISION.md) — Vision, PRD, BRD, Personas, SaaS Scope, Multi-Tenant & NFRs
- [`docs/02-business-logic/`](./docs/02-business-logic/CUSTOMER_FLOW.md) — Customer Flow, Onboarding, Token Gen, FIFO Engine, Transitions, Wait Engine, Push Logic
- [`docs/03-ux-design/`](./docs/03-ux-design/USER_FLOWS.md) — User Flows, IA, Screen Specs, Design System, Responsive Design
- [`docs/04-architecture/`](./docs/04-architecture/SYSTEM_ARCHITECTURE.md) — System, Multi-Tenant, App, Backend, Real-Time, Notification & Outbox Architecture
- [`docs/05-database/`](./docs/05-database/DATABASE_DESIGN.md) — Schema, ERD, Tenant Isolation & RLS, Indexing, Transactions, Data Retention
- [`docs/06-api/`](./docs/06-api/API_SPECIFICATION.md) — API Standards, Auth, RBAC, Errors, Public/Owner/Platform Admin APIs
- [`docs/07-security/`](./docs/07-security/SECURITY_REQUIREMENTS.md) — Security, Privacy, Tenant Security, Rate Limiting, STRIDE Threat Model
- [`docs/08-testing/`](./docs/08-testing/TESTING_STRATEGY.md) — Testing Strategy, Unit, Integration, E2E, Tenant Isolation, Concurrency, Push Tests
- [`docs/09-devops/`](./docs/09-devops/DEVELOPMENT_SETUP.md) — Dev Setup, Env Vars, Deployment, Service Workers, Background Jobs, Backups, Monitoring
- [`docs/10-project-management/`](./docs/10-project-management/IMPLEMENTATION_ROADMAP.md) — Phases 0–17 Roadmap, Acceptance Criteria, Risks & Changelog

### Governance Files
- [`AGENTS.md`](./AGENTS.md) — Mandatory engineering & AI collaboration standards.
- [`PROJECT_STATUS.md`](./PROJECT_STATUS.md) — Current project phase and completion tracker.
- [`DECISIONS.md`](./DECISIONS.md) — Architecture Decision Records (ADRs) & open decisions.

---

## Current Status

> **Stage**: Documentation & Architecture Complete — **Awaiting Explicit Approval to Begin Phase 0**.
