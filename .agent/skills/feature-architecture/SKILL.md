---
name: feature-architecture
description: >-
  Enforces SalonFlow's feature-wise modular directory layout, semantic CSS design tokens
  in Tailwind, lean zero-bloat TypeScript, appropriate data structures, and fast UX patterns.
  Activate whenever creating, structuring, or refactoring any application feature or UI module.
---

# Feature-Wise Scalable Architecture & Token CSS Skill

Follow these exact rules for every SalonFlow feature (`onboarding`, `branches`, `services`, `queue`, `tokens`, `push`, `analytics`, `admin`):

## 1. Maintainable Feature-Wise Directory Structure

- **Route Adapters (`src/app/`)**: Thin pages, layouts, and API Route Handlers ONLY (`auth -> resolveTenant -> Zod validate -> domain service -> map error -> JSON/JSX`).
- **Feature Modules (`src/features/<feature>/`)**:
  - `components/` — Feature-specific React components (client/server).
  - `hooks/` — Client hooks (SSE stream, SW subscription, optimistic UI).
  - `schemas.ts` — Feature Zod schemas & DTO types (imported by both UI forms and API routes).
  - `types.ts` — Lean view-model types (never leak Prisma entity models directly to UI).
- **Shared UI Primitives (`src/components/ui/`)**: Reusable stateless tokens-based components (`Button`, `Input`, `StatusBadge`, `Modal`, `StatCard`).
- **Server-Only Core (`src/server/`)**:
  - `services/` — Business logic isolated from HTTP/React.
  - `db/` — Prisma singleton, `withTenantDb` RLS wrapper, atomic SQL helpers.
  - `auth/`, `security/`, `notifications/`, `jobs/`, `realtime/`.
- **Boundary Rule**: `src/features/*` and `src/components/*` MUST NEVER import `src/server/*` or `@prisma/client`.

## 2. Token-Based Tailwind CSS (Zero Ad-Hoc Hardcoded Colors)

1. Define all colors, surfaces, borders, status badges, and spacing/radii as semantic CSS variables in `src/app/globals.css` (`--sf-bg-canvas`, `--sf-bg-surface`, `--sf-text-primary`, `--sf-brand-primary`, `--sf-status-waiting-bg`, etc.).
2. Map those CSS variables in `tailwind.config.ts` under `theme.extend.colors` (`canvas`, `surface`, `ink`, `brand`, `status.*`).
3. Components MUST use semantic Tailwind classes (`bg-surface`, `text-ink`, `border-subtle`, `bg-status-waiting-bg text-status-waiting-fg`) — NEVER raw hex codes (`#...`) or arbitrary `bg-[#...]` in component JSX!

## 3. Lean Code & Zero Bloat

- Write ONLY the code strictly required for the active task/phase.
- No speculative abstractions, unused props, redundant wrapper files, or dead `TODO` placeholders.
- Prefer small, single-purpose pure functions with early returns and explicit types (`strict: true`, `noUncheckedIndexedAccess: true`).

## 4. Data Structures & Fast Execution

- Use **`Set`** for `O(1)` permission checks (`ctx.permissions.has(...)`), branch access (`allowedBranchIds.has(branchId)`), and service ID deduplication.
- Use **`Map`** for `O(1)` catalog hydration, SSE subscriber registries (`Map<string, Set<Subscriber>>`), and single-pass wait-time projection lookups (`Map<publicId, WaitProjection>`).
- Use **ordered station arrays / min-selection** in `WaitTimeService`, **sliding-window ring/Map** in rate limiters, and **single SQL conditional aggregations** (`COUNT(*) FILTER`) instead of multi-query loops.
- Keep public client bundles tiny: never import heavy dashboard/chart libraries into `(public)` customer routes.

## 5. Checklist Before Finishing a Feature
- [ ] Feature files live cleanly under `src/features/<feature>/` + `src/server/services/`.
- [ ] Zero raw hex colors in JSX; all Tailwind classes reference semantic tokens.
- [ ] Zero N+1 loops; `Map`/`Set` used where lookups repeat.
- [ ] `npm run typecheck`, `npm run lint`, and feature tests pass.

