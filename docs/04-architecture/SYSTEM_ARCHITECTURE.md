# System Architecture — SalonFlow SaaS

## 1. Modular Monolith Architecture

SalonFlow is built as a **single deployable Next.js App Router + PostgreSQL Modular Monolith** (strictly avoiding microservices and Turborepo overhead per Section 12).

### Internal Module Boundaries
1. **Transport Layer (`src/app/`)**: SSR pages, REST Route Handlers, Server Actions, SSE endpoints, Security Middleware.
2. **Domain Services Layer (`src/server/services/`)**: Tenant/Branch, Services, Token Engine, FIFO Queue, Wait Engine, Analytics, QR, Platform Admin.
3. **Notification & Outbox Engine (`src/server/notifications/`, `src/server/jobs/`)**: Transactional outbox claimer (`FOR UPDATE SKIP LOCKED`), Web Push VAPID adapter, retry/dead-letter manager, expired endpoint cleaner.
4. **Realtime Hub (`src/server/realtime/`)**: Branch-scoped single-pass SSE snapshot publisher (`EventEmitter` / PostgreSQL `LISTEN-NOTIFY`).
5. **Security & Isolation Layer (`src/server/auth/`, `src/server/db/`, `src/server/security/`)**: Session/RBAC context resolution, RLS transaction wrapper, rate limiter, crypto utilities.

---

## 2. High-Level System Diagram

```text
┌────────────────────┐     ┌────────────────────┐     ┌────────────────────┐
│ Customer Mobile    │     │ Owner/Staff Device │     │ Platform Admin     │
│ (/salon/s/b)       │     │ (/owner/...)       │     │ (/admin/...)       │
└─────────┬──────────┘     └─────────┬──────────┘     └─────────┬──────────┘
          │ HTTPS + SSE              │ HTTPS + SSE              │ HTTPS
          └──────────────────────────┼──────────────────────────┘
                                     ▼
          ┌──────────────────────────────────────────────────────┐
          │             Next.js App Router Monolith              │
          │  • Auth.js Session + Tenant/Branch RBAC Guard        │
          │  • Rate Limiter + Zod Validation                     │
          │  • Domain Services (FIFO, Token, Wait, Analytics)    │
          │  • Realtime SSE Hub (Single-Pass Snapshot Fan-Out)   │
          │  • Background Outbox Processor (Web Push + Retries)  │
          └──────────────────┬───────────────────────┬───────────┘
                             │                       │
          Pooled DATABASE_URL│                       │ HTTPS (VAPID JWT)
          & DIRECT_URL       ▼                       ▼
          ┌────────────────────────────┐   ┌────────────────────────────┐
          │      PostgreSQL 16+        │   │ Browser Push Services      │
          │ • Multi-Tenant Composite   │   │ (FCM / Mozilla / Apple)    │
          │   FKs & RLS Policies       │   └─────────────┬──────────────┘
          │ • Transactional Outbox     │                 │ Push Message
          │ • Advisory & Row Locks     │                 ▼
          └────────────────────────────┘   ┌────────────────────────────┐
                                           │ /sw.js Service Worker      │
                                           │ (Owner & Customer Devices) │
                                           └────────────────────────────┘
```
