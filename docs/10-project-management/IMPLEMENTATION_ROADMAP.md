# Implementation Roadmap — SalonFlow SaaS (Phases 0 – 17)

## 1. Execution Philosophy

SalonFlow builds incrementally across **18 verified phases (Phases 0–17)** inside a single Next.js + PostgreSQL Modular Monolith. No phase advances until all typechecks, lint, and phase-specific automated tests pass.

```text
Phase 0 (Foundation)
  ├──► Phase 1 (DB, Composite Keys & RLS)
  │       ├──► Phase 2 (Auth & RBAC)
  │       │       └──► Phase 4 (Onboarding & Branches) ──► Phase 5 (Services)
  │       │               └──► Phase 10 (Owner Dashboard) ──► Phase 14 (Analytics)
  │       │               └──► Phase 15 (Platform Admin)
  │       ├──► Phase 7 (Atomic Token Engine) ◄── Phase 6 (Public QR UI)
  │       │       ├──► Phase 8 (Strict FIFO Engine)
  │       │       ├──► Phase 9 (Customer Token Tracking)
  │       │       └──► Phase 11 (Web Push Infra & Owner Alerts)
  │       │               └──► Phase 12 (Customer Push Notifications)
  └──► Phase 3 (Design System & Shell)
          └──► Phase 13 (Real-Time SSE + ETag Fallback)
                  └──► Phase 16 (Security, Concurrency & Performance Testing)
                          └──► Phase 17 (Production Deployment)
```

---

## 2. Phase Overview

| Phase | Milestone | Primary Verification |
| :---: | :--- | :--- |
| **0** | Project foundation | Strict TS, env schema, Pino logger, `/api/health` |
| **1** | Database and tenant architecture | 19+ entities, composite FKs, RLS migration, multi-tenant seed |
| **2** | Authentication and authorization | Auth.js v5, RBAC permissions, branch access guard, `TI-01..05` |
| **3** | Design system and application shell | Mobile-first UI primitives, public/dashboard/admin layouts |
| **4** | Salon onboarding and branch management | `/register`, branch CRUD, business hours, staff invites |
| **5** | Services management | Org services & per-branch `BranchService` availability/overrides |
| **6** | Public QR customer interface | `/salon/{salon-slug}/{branch-slug}`, Zod form, branch status |
| **7** | Token generation engine | Atomic `QueueCounter`, duplicate guard, wait engine, `CT-01..04` |
| **8** | FIFO queue management engine | `Call Next` (`SKIP LOCKED`), 7-state machine, history, `CT-05..06` |
| **9** | Customer token tracking | Unguessable `/token/{publicId}`, masked phone, self-cancel |
| **10** | Owner dashboard | Live KPIs (single SQL aggregation), branch switcher, QR studio |
| **11** | Web Push infrastructure and owner notifications | VAPID, `/sw.js`, Outbox worker, multi-device owner push, `NT-01..02` |
| **12** | Customer push notifications | Post-token opt-in UX, anti-flap milestones (`3`,`1`,`called`), `NT-03` |
| **13** | Real-time queue updates | Single-pass SSE fan-out (`PG LISTEN/NOTIFY`), `ETag`/`304` fallback |
| **14** | Analytics and reporting | Daily/weekly/monthly trends, top services, branch comparisons |
| **15** | Platform administration | `/admin` tenant suspension, aggregated metrics, job/DLQ inspector |
| **16** | Security, concurrency and performance testing | Full unit, integration, tenant-isolation, concurrency, perf & E2E suites |
| **17** | Production deployment | Docker standalone build, SSL/SW headers, backup/RLS restore drill |

*(Detailed tasks, deliverables, acceptance criteria, and tests for every phase are in [`DEVELOPMENT_PHASES.md`](./DEVELOPMENT_PHASES.md).)*
