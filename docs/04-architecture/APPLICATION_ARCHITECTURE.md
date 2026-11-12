# Application Architecture

## 1. Dependency Rule & Separation of Concerns

```text
  src/app/ (Thin Pages, Layouts, Route Handlers, Server Actions)
     │
     ├──► src/features/<feature>/ (Feature Components, Client Hooks, DTO Schemas)
     │       └──► src/components/ui/ (Stateless Token-Styled Primitives)
     │
     └──► src/server/services/ (Tenant-aware Domain Services)
               │
               ├──► src/server/db/ (Prisma, RLS Transaction Helper, Atomic SQL)
               ├──► src/server/notifications/ (VAPID Web Push + Outbox Writer)
               ├──► src/server/jobs/ (Outbox Worker + Retry/DLQ Runner)
               ├──► src/server/realtime/ (Single-Pass SSE Hub)
               └──► src/server/security/ (Rate Limiter, Crypto, IP Hash)

  Pure Shared Utilities: src/lib/ (Zod schemas, formatters, FIFO & Wait math, errors)
```

- **Strict Rule**: `src/features/*` and `src/components/*` never import `src/server/*` or `@prisma/client`. Domain services never import Next.js `cookies()`, `headers()`, or `NextRequest`. UI styling relies exclusively on semantic CSS tokens mapped into Tailwind (`globals.css` -> `tailwind.config.ts`).

---

## 2. Rendering & Bundle Isolation

- **Public Routes (`(public)`)**: Server-rendered initial branch/service state via `SalonService` / `TokenService`; lightweight client bundle containing only form validation, Service Worker registration helper, and `useRealtimeStream`. Zero admin/chart dependencies bundled!
- **Owner Workspace Routes (`(owner)`)**: Server Components validate session & RBAC before streaming layout; mutations invoke typed REST Route Handlers (`/api/owner/...`) for predictable HTTP error codes, `ETag` support, and clean integration testing.
- **Admin Routes (`(admin)`)**: Strictly guarded for `isPlatformAdmin`; separate layout and endpoints (`/api/admin/...`).
