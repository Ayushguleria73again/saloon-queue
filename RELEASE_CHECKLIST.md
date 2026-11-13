# SalonFlow SaaS — Production Release & Go-Live Checklist

**Document Version**: 1.0.0  
**Target Release**: SalonFlow SaaS v0.19.0 (Pilot / Production Release)  
**Author**: Release Engineering & Operations Committee  
**Rule**: All checklist items marked with **[CRITICAL GATE]** must be verified and checked off prior to opening the system to live customer traffic.

---

## 1. Hosting & Infrastructure Provisioning

- [ ] **[CRITICAL GATE] Server Provisioning**: Linux VPS (Ubuntu 22.04 LTS or 24.04 LTS), minimum 2 vCPU, 4 GB RAM, 40 GB NVMe SSD (e.g. Hetzner CPX21, DigitalOcean Droplet, AWS t4g.medium).
- [ ] **[CRITICAL GATE] Container Runtime**: Docker Engine (v24.0+) and Docker Compose (v2.20+) installed and enabled on boot (`systemctl enable docker`).
- [ ] **Firewall & Ports**:
  - Inbound Port `22` (SSH - key-based authentication only, password auth disabled).
  - Inbound Port `80` (HTTP - redirects to HTTPS).
  - Inbound Port `443` (HTTPS - TLS 1.3/1.2).
  - Inbound Port `5432` / `5434` **BLOCKED** from public internet (internal Docker network only).
- [ ] **DNS Records**:
  - `salonflow.com` &rarr; `A` record pointing to VPS IP address.
  - `*.salonflow.com` (or specific branch subdomains) &rarr; `A` record pointing to VPS IP address.
  - TTL configured to 300s during initial launch window.

---

## 2. Secrets & Production Environment Configuration

Create `/opt/salonflow/.env.production` with mode `600` (`chmod 600 .env.production`). Verify all variables:

- [ ] **[CRITICAL GATE] `DATABASE_URL`**: Connects via unprivileged non-superuser role:
  ```text
  DATABASE_URL="postgresql://app_runtime:GENERATED_RUNTIME_PASSWORD@db:5432/salonflow?schema=public&connection_limit=30"
  ```
- [ ] **[CRITICAL GATE] `DIRECT_URL`**: Connects via schema owner for migrations:
  ```text
  DIRECT_URL="postgresql://salonflow_admin:GENERATED_ADMIN_PASSWORD@db:5432/salonflow?schema=public"
  ```
- [ ] **[CRITICAL GATE] `AUTH_SECRET`**: High-entropy 64-character random string:
  ```bash
  openssl rand -base64 48
  ```
  *(Never use the development placeholder!)*
- [ ] **[CRITICAL GATE] `IP_HASH_SALT`**: High-entropy 32-character hexadecimal salt:
  ```bash
  openssl rand -hex 16
  ```
- [ ] **[CRITICAL GATE] `CRON_SECRET`**: High-entropy 32-character random string:
  ```bash
  openssl rand -hex 16
  ```
- [ ] **[CRITICAL GATE] Web Push VAPID Keypair**: Generated via `npx web-push generate-vapid-keys`:
  - `NEXT_PUBLIC_VAPID_PUBLIC_KEY`: Extracted public key.
  - `VAPID_PRIVATE_KEY`: Extracted private key.
  - `VAPID_SUBJECT`: Valid mailto URI (e.g. `mailto:security@salonflow.com`).
- [ ] **Application URLs**:
  - `NEXT_PUBLIC_APP_URL="https://salonflow.com"`
  - `AUTH_URL="https://salonflow.com"`
- [ ] **[CRITICAL GATE] Automated Secrets Validation Execution**:
  ```bash
  npm run env:validate
  ```
  Verify exit code 0 ("Production Secrets Validation: PASSED").

---

## 2B. Automated Test Verification & Reconciled Baseline

- [ ] **[CRITICAL GATE] Full Suite Reconciled Pass (181 Tests)**:
  - Unit Suite: `npm run test:unit` (95 / 95 passing across 20 files).
  - Integration Suite: `npm run test:int` (86 / 86 passing across 19 files).
  - Total: **181 / 181 passing tests** (reconciles original 168 tests + 13 whole-feature bug hunt tests).
  - Typecheck: `npm run typecheck` (0 errors).
  - Lint: `npm run lint` (0 warnings/errors).
  - Build: `npm run build` (18 / 18 static & dynamic routes compiled).

---

## 3. Database Migration, RLS & Platform Admin Provisioning

Execute the automated deployment prerequisites script:

```bash
cd /opt/salonflow
./scripts/deploy.sh
```

Verify that the output displays:
- [ ] **[CRITICAL GATE] Migration Output**: `npx prisma migrate deploy` completes with "No pending migrations to apply" or applied all committed migrations cleanly.
- [ ] **[CRITICAL GATE] Runtime Role Grants**: `app_runtime` created with `NOSUPERUSER NOBYPASSRLS`.
- [ ] **[CRITICAL GATE] RLS Audit Check**: Script outputs:
  ```text
  [DEPLOY 4/4] Auditing Row-Level Security (RLS) on production database...
  SalonFlow Production Deployment Prerequisites Verified Successfully!
  ```
- [ ] **[CRITICAL GATE] Platform Administrator Seeded**:
  ```bash
  npm run seed:admin
  ```
  Verify that the root administrator email and temporary password are saved into the team password manager (e.g. 1Password / Bitwarden).

---

## 4. SSL/TLS & Reverse Proxy Configuration

- [ ] **[CRITICAL GATE] HTTPS Termination Active**:
  - Option A (Cloudflare): Cloudflare SSL mode set to **Full (Strict)**. Edge certificates active.
  - Option B (Certbot on VPS): Let's Encrypt certificates generated and mounted into Nginx container:
    ```bash
    certbot certonly --standalone -d salonflow.com -d www.salonflow.com
    ```
- [ ] **HTTP to HTTPS Redirection**: Visiting `http://salonflow.com` automatically redirects to `https://salonflow.com` with HTTP 301.
- [ ] **Security Headers Audit**: Verify via `curl -I https://salonflow.com`:
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains` present.
  - `X-Frame-Options: DENY` present.
  - `X-Content-Type-Options: nosniff` present.
  - `Content-Security-Policy` present.

---

## 5. Container Stack Launch & Health Check

- [ ] **Container Build & Startup**:
  ```bash
  docker compose -f docker-compose.prod.yml up -d --build
  ```
- [ ] **Verify Container Status**:
  ```bash
  docker compose -f docker-compose.prod.yml ps
  ```
  All three containers (`salonflow-prod-db`, `salonflow-prod-app`, `salonflow-prod-proxy`) must report `Up (healthy)`.
- [ ] **Application Health Check Telemetry**:
  ```bash
  curl -s https://salonflow.com/api/health | jq .
  ```
  Expected output:
  ```json
  {
    "status": "ok",
    "service": "salonflow",
    "db": "connected",
    "latencyMs": 2,
    "timestamp": "..."
  }
  ```

---

## 6. End-to-End Operational Smoke Test (Staging Salon)

Perform this 5-minute manual smoke test immediately following launch:

1. **Owner Registration**: Navigate to `https://salonflow.com/register`. Register a test salon organization ("Launch Validation Salon").
2. **Email Verification**: Open verification link logged in console or delivered via email. Account verified.
3. **Branch Setup**: Confirm default branch ("Main Branch") is active. Set active stations to 3.
4. **Service Catalog**: Create service "Haircut" (₹300, 30 mins).
5. **QR Code Generation**: Open `/owner/qr`. Verify QR code renders clearly and includes the secure `?t=...` parameter.
6. **Customer Public Intake**:
   - Open mobile browser. Scan QR code.
   - Enter Name ("Test Customer") and Mobile (`9876543210`).
   - Select "Haircut". Submit.
   - Verify Token `A001` created and redirects to `/token/{publicId}`.
7. **Web Push Subscription**:
   - Tap "Notify Me on Phone". Approve browser notification prompt.
   - Confirm subscription logged in database (`push_subscriptions` table).
8. **Staff Queue Advance**:
   - In Owner dashboard, tap "Call Next".
   - Confirm Token `A001` moves to "Called".
   - Confirm customer phone displays lock-screen alert.
   - Customer screen updates in real-time via SSE without page refresh.
9. **Complete Service**:
   - Staff marks "In Service", then "Complete".
   - Customer screen updates to "Completed".
   - Stream cleanly disconnects.

---

## 7. Disaster Recovery & Automated Backup Schedule

- [ ] **Automated Daily Backups**: Add cron job on the VPS host:
  ```bash
  0 2 * * * /opt/salonflow/scripts/backup.sh >> /var/log/salonflow_backup.log 2>&1
  ```
- [ ] **Backup Script Verification**:
  ```bash
  /opt/salonflow/scripts/backup.sh
  ls -lh /opt/salonflow/backups/
  ```
  Verify backup file is created with `.dump` extension and size > 100 KB.
- [ ] **Remote Mirroring**: Configure `scripts/sync-backup-offsite.sh` (`npm run db:backup:offsite`) in host crontab to sync `/opt/salonflow/backups/` to an encrypted S3/GCS bucket (`BACKUP_S3_BUCKET`) daily with AES256 server-side encryption:
  ```bash
  15 2 * * * /opt/salonflow/scripts/sync-backup-offsite.sh >> /var/log/salonflow_backup_sync.log 2>&1
  ```

---

## 8. Horizontal Clustered Scale Governance

- [ ] **Single-Instance Monolith Boundary Verified**: Verified that current single-node deployment satisfies up to 2,000 daily tokens and 500 concurrent SSE streams without clustered overhead.
- [ ] **Scale-Readiness Plan Documented**: Verified architectural migration plan in `docs/04-architecture/SCALE_READINESS.md` for PostgreSQL LISTEN/NOTIFY fan-out and Redis sliding-window distributed rate limiting when crossing horizontal scaling triggers.

---

## 9. Go / No-Go Decision Gate & Sign-Off

| Review Criterion | Responsible Lead | Sign-Off Status | Signature / Date |
|---|---|---|---|
| **Security & RLS Invariants** | Security Architect | [ ] APPROVED | ________________ |
| **FIFO Concurrency & DB Integrity** | Backend Lead | [ ] APPROVED | ________________ |
| **DevOps & Container Stack** | SRE / DevOps Lead | [ ] APPROVED | ________________ |
| **Real-Device Push & UX** | QA / Pilot Operations | [ ] APPROVED | ________________ |
| **Business & Salon Partner** | Product Manager | [ ] APPROVED | ________________ |

**Decision**:
- **GO**: All items checked. Proceed with live salon counter deployment.
- **NO-GO**: Any **[CRITICAL GATE]** failed. Halt deployment and execute rollback procedure.

