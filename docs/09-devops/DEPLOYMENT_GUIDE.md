# Production Deployment Guide

## 1. Hosting Architecture Evaluation & Selection (`ADR-012`)

SalonFlow requires persistent Node.js processes (for uninterrupted SSE streams, long-running background outbox workers, and scheduled maintenance loops), managed PostgreSQL with low latency, and automatic TLS/HTTPS (mandatory for Web Push & Service Workers).

| Platform | Persistent Workers & SSE | Managed PostgreSQL | India Latency | Ops Overhead | Verdict |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **Railway** | ✅ Persistent Docker Node | ✅ Built-in Managed PG + Backups | Good (`ap-southeast` Singapore ~55ms) | **Minimal** (Git/Docker push, env UI) | **✅ SELECTED (MVP Primary)** |
| **Render** | ✅ Docker Web Service | ✅ Managed PG (Singapore) | Good (~55ms) | Low (brief SSE drop on rolling deploys) | Viable Alternative |
| **Fly.io** | ✅ Micro-VM Docker | ⚠️ Unmanaged / External Neon PG | **Excellent** (`bom` Mumbai ~20ms) | Medium (Fly CLI + external PG setup) | Scale-Out / Low-Latency India Option |
| **VPS (DO/Lightsail)** | ✅ Full Docker Compose | ⚠️ Self-managed PG or Managed RDS | **Excellent** (`blr1`/`bom` ~15ms) | High (OS patching, Caddy, backups) | Cost-Optimized Scale Option |

### Selected Hosting Option: **Railway (Dockerized Node.js Container + Managed PostgreSQL)**
- Runs one persistent `Dockerfile` standalone Next.js server (`OUTBOX_WORKER_ENABLED=true`) alongside Managed PostgreSQL (`DATABASE_URL` pooled + `DIRECT_URL`), giving zero-config HTTPS, native background worker execution, uninterrupted SSE streams, and scheduled maintenance ticks (`POST /api/internal/jobs/process` or built-in cron).
- Remains 100% Docker-portable to **Fly.io (`bom` Mumbai)** or **DigitalOcean Bengaluru VPS** with zero code changes.

- **Why HTTPS is Mandatory**: Browsers block Service Workers (`navigator.serviceWorker`) and Web Push API on non-HTTPS origins in production.

---

## 2. Container & Reverse Proxy Requirements

1. **Docker Build**: Multi-stage `node:20-alpine` using Next.js `output: "standalone"`, copying `public/sw.js` and Prisma client cleanly, running as non-root user.
2. **PostgreSQL Role Separation**:
   - Migrations (`npx prisma migrate deploy`) run via `DIRECT_URL` (schema owner).
   - Runtime Next.js server & outbox worker connect via `DATABASE_URL` using a **non-superuser** role (`app_runtime`) so PostgreSQL RLS policies remain active!
3. **Reverse Proxy Headers (Nginx / Caddy)**:
   - `Service-Worker-Allowed: /` and `Cache-Control: no-cache, no-store, must-revalidate` on `/sw.js` so browser picks up Service Worker updates promptly!
   - Disable proxy buffering (`X-Accel-Buffering: no`, `proxy_buffering off;`) for SSE endpoints (`/api/**/events`) and set proxy read timeout `>= 120s`.

---

## 3. Launch Checklist
1. Generate production VAPID keys (`npx web-push generate-vapid-keys`) and store securely.
2. Run `npx prisma migrate deploy` and seed initial Platform Admin account via protected CLI script.
3. Verify `/api/health` returns `200`, register a smoke-test salon, verify Web Push on Android Chrome + Desktop Chrome, and execute backup restore test.
