# Development Setup Guide — SalonFlow SaaS

*(Target workflow once Phase 0 implementation begins.)*

## 1. Prerequisites
- **Node.js**: `>= 20.11` LTS (local verified `v25.9.0`).
- **PostgreSQL**: `16+` (Docker Compose `postgres:16-alpine` recommended).
- **VAPID Keys**: Generated locally using `npx web-push generate-vapid-keys` for Web Push testing.

---

## 2. Local Setup Steps (Target Workflow)

1. `npm install`
2. Start local PostgreSQL: `docker compose up -d db`
3. Copy `.env.example` to `.env` and populate `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `IP_HASH_SALT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
4. Apply migrations (including RLS policies) & run multi-tenant seed:
   ```bash
   npx prisma migrate dev
   npx prisma db seed
   ```
   Seed initializes a Platform Admin, 2 sample salons (`aura-grooming` with 2 branches `main` & `west`, and `urban-trim` with 1 branch) for multi-tenant & isolation testing.
5. Start dev server (with HTTPS note: `http://localhost:3000` is treated as a secure context by Chrome/Firefox for Service Workers & Web Push testing!).

---

## 3. Verification Commands

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run test:int          # Integration + Tenant Isolation + Notification + Concurrency tests
npm run test:e2e          # Playwright tests
```
