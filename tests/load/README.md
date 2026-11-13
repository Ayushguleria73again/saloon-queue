# SalonFlow — Production Load Testing Framework

Comprehensive, repeatable hybrid load testing framework for SalonFlow built on **Artillery v2** and **Playwright**. Capable of simulating 1,000+ concurrent virtual users across multi-tenant FIFO queuing, owner dashboard operations, real-time Server-Sent Events (SSE), and end-to-end browser workflows.

---

## 1. Architecture

The framework implements a **hybrid load testing strategy**:

```
                                  ┌───────────────────────────────┐
                                  │      Load Generation Host     │
                                  └──────────────┬────────────────┘
                                                 │
            ┌────────────────────────────────────┼────────────────────────────────────┐
            ▼                                    ▼                                    ▼
┌───────────────────────┐            ┌───────────────────────┐            ┌───────────────────────┐
│ Protocol Virtual Users│            │Playwright Browser VUs │            │Dedicated SSE Streams  │
│  (Artillery HTTP Core)│            │  (Headless Chromium)  │            │(Realtime Event Stream)│
│    95%+ volume target │            │  E2E UI & DOM parsing │            │ Longevity & Keepalive │
└───────────┬───────────┘            └───────────┬───────────┘            └───────────┬───────────┘
            │                                    │                                    │
            └────────────────────────────────────┼────────────────────────────────────┘
                                                 │
                                                 ▼
                               ┌───────────────────────────────────┐
                               │     SalonFlow Next.js Server      │
                               │      (Port 3000 / Port 80)        │
                               └─────────────────┬─────────────────┘
                                                 │
                                                 ▼
                               ┌───────────────────────────────────┐
                               │   PostgreSQL 16 + Row Locking     │
                               │ (FOR UPDATE SKIP LOCKED / public) │
                               └───────────────────────────────────┘
```

1. **Protocol-level Virtual Users (Artillery HTTP Engine)**:
   - High-throughput API workloads simulating 10 to 2,000 concurrent customers and salon operators.
   - Evaluates PostgreSQL row locks (`queue_counters`, `tokens`), NextAuth session validation, FIFO ordering, rate limiter buckets, and conditional HTTP caching (`ETag` / `304 Not Modified`).
2. **Browser Virtual Users (Playwright Engine)**:
   - Real headless Chromium browser instances verifying DOM rendering, input validation, client-side state transitions, and redirection from intake to `/token/{publicId}`.
   - Run at controlled concurrency (3–10 VUs) to measure real First Contentful Paint (FCP) and interactive latency without developer machine CPU starvation.
3. **Dedicated SSE Stream Longevity Scenario**:
   - Tests concurrent long-lived HTTP GET streams against `/queue/events` and `/token/{publicId}/events`.
   - Validates socket connection limits, keepalive ping reception (`: ping\n\n`), connection churn, and event broadcasting.
4. **Distributed Execution Strategy**:
   - For tests targeting 2,000+ to 10,000+ VUs across geographically separated regions, Artillery test configs support containerized deployment (Docker, AWS ECS/Fargate, or Artillery Cloud).

---

## 2. Directory Structure

```text
tests/load/
├── README.md                      # Framework documentation and operational runbook
├── artillery.config.yml           # Base Artillery configuration, environments, and plugins
├── data/
│   ├── generate-synthetic-data.js # Generator for Indian names, mobile numbers, and unique IPs
│   ├── helper.js                  # Artillery custom hooks (ETag capture, duplicate detection)
│   └── test-tenants.json          # Seeded test organizations, branches, services, and credentials
├── scenarios/
│   ├── customer-flow.yml          # Customer intake, token generation, polling, and cancellation
│   ├── owner-flow.yml             # Staff auth, queue inspection, call next, and completion
│   ├── sse-flow.js                # Dedicated SSE connection longevity & ping detector
│   └── browser-flow.js            # Playwright browser end-to-end user journey
├── profiles/
│   ├── 01-smoke.yml               # 10 users: functional verification under light load
│   ├── 02-baseline.yml            # 50 users: normal operating latency and throughput
│   ├── 03-load.yml                # 250 users: expected peak production traffic
│   ├── 04-stress.yml              # 500 users: saturation threshold assessment
│   ├── 05-capacity.yml            # 1,000 users: scale target evaluation
│   ├── 06-spike.yml               # 1,000 - 2,000 users: flash traffic surge & recovery
│   ├── 07-soak.yml                # 500 users sustained: endurance & connection leak check
│   ├── 08-browser.yml             # Playwright browser virtual user configuration
│   └── 09-sse.yml                 # SSE connection ramp-up and longevity profile
├── scripts/
│   ├── seed-load-data.ts          # Seeds 3 isolated multi-tenant orgs, 6 branches, 24/7 hours
│   ├── cleanup-load-data.ts       # Cleans up synthetic load records without touching prod data
│   ├── monitor-metrics.ts         # Real-time PostgreSQL and Node.js telemetry collector
│   └── run-all-profiles.sh        # Automated suite runner generating JSON & HTML reports
└── reports/                       # Output directory for Artillery HTML & JSON reports
```

---

## 3. Test Profiles & Concurrency Targets

| Profile | Concurrency Target | Duration | Primary Focus |
| :--- | :--- | :--- | :--- |
| **01-smoke** | **10 VUs** | 5s | Verifies endpoint connectivity, schema validity, and HTTP 200/201 status codes. |
| **02-baseline** | **50 VUs** | 15s | Measures baseline p50/p95 latency and RPS under normal salon operating traffic. |
| **03-load** | **250 VUs** | 30s | Simulates peak weekend customer rush across all seeded branches. |
| **04-stress** | **500 VUs** | 25s | Evaluates system behavior as concurrency approaches database connection pool limits. |
| **05-capacity** | **1,000 VUs** | 30s | Evaluates system throughput at the target 1,000 concurrent user milestone. |
| **06-spike** | **1,000–2,000 VUs** | 30s | Sudden burst from 25 to 1,200+ arrival rate to verify backpressure and recovery. |
| **07-soak** | **500 VUs** | 100s | Endurance testing to detect memory leaks, event loop lag, and connection exhaustion. |
| **08-browser** | **3–5 Browser VUs** | 15s | Real headless Chromium DOM execution validating user experience and render times. |
| **09-sse** | **150 SSE Streams** | 20s | Tests long-lived SSE connections and ping keepalives. |

---

## 4. Safety Constraints & Invariants

1. **Safety Constraints**:
   - **Never Target Production or Third-Party Services**: Load tests must run exclusively against local (`http://localhost:3000`) or dedicated staging environments.
   - **Outbox Worker Disabled During Load Generation**: Set `OUTBOX_WORKER_ENABLED=false` during load tests to prevent outbound Web Push or email network calls.
   - **Synthetic PII Only**: Customer names and phone numbers are generated dynamically (`98XXXXXXXX`) and never reference real individuals.
2. **Tenant Isolation**:
   - Seeding establishes 3 dedicated organizations (`load-salon-1`, `load-salon-2`, `load-salon-3`) with distinct UUIDs. Virtual users are partitioned across tenants to verify zero cross-tenant contamination.
3. **Anti-Collusion Rate Limit Simulation**:
   - Each virtual user session is assigned a unique randomized client IP (`10.X.Y.Z`) injected via the `X-Forwarded-For` header. This prevents all synthetic users from colliding into a single `127.0.0.1` rate-limit bucket while testing true application capacity.

---

## 5. Quick Start Guide

### Step 1: Start SalonFlow Server (with Outbox Worker Disabled)
```bash
# Terminal 1: Start server in production mode for accurate performance metrics
npm run build
OUTBOX_WORKER_ENABLED=false npm run start
```

### Step 2: Seed Load Test Data
```bash
# Terminal 2: Seed test tenants and 24/7 operating hours
npm run load:seed
```

### Step 3: Run Test Profiles
```bash
# Run Smoke Test (10 users)
npm run load:smoke

# Run Baseline Test (50 users)
npm run load:baseline

# Run Peak Load Test (250 users)
npm run load:load

# Run Stress Test (500 users)
npm run load:stress

# Run Capacity Test (1,000 users)
npm run load:capacity

# Run Spike Test (1,000 to 2,000 users)
npm run load:spike

# Run Soak Test (500 users sustained)
npm run load:soak

# Run Playwright Browser Flow (3 concurrent browsers)
npm run load:browser

# Run Dedicated SSE Longevity Test (50 streams)
npm run load:sse
```

### Step 4: Run Automated Full Suite with Reports
```bash
# Executes all profiles and compiles HTML reports in tests/load/reports/
npm run load:suite
```

### Step 5: Clean Up Synthetic Data
```bash
# Cleans up all generated tokens, customers, and audit logs
npm run load:cleanup

# To completely purge the test organizations and owner accounts:
npx vite-node tests/load/scripts/cleanup-load-data.ts --purge-all
```

---

## 6. Distributed Load Generation (Scaling to 5,000+ VUs)

When running tests that exceed the network stack or CPU capacity of a single developer machine (e.g. 5,000+ concurrent users), Artillery provides native distributed execution:

### Option A: Distributed Execution via AWS ECS / Fargate
Artillery supports launching ephemeral serverless containers across multiple AWS availability zones:
```bash
# Ensure AWS credentials are configured in your environment
npx artillery run-fargate tests/load/profiles/05-capacity.yml \
  --count 5 \
  --region ap-south-1
```
*(Splits 1,000 VUs across 5 independent Fargate containers generating 200 VUs each).*

### Option B: Artillery Cloud
```bash
npx artillery run --record --key <ARTILLERY_CLOUD_API_KEY> tests/load/profiles/05-capacity.yml
```

---

## 7. Telemetry Monitoring

To capture real-time database locks and memory metrics alongside load tests:
```bash
# Terminal 3: Collect Postgres & Node.js metrics for 60 seconds
node tests/load/scripts/monitor-metrics.ts 60
```
Outputs:
- Peak active PostgreSQL connections
- Blocked transactions (`pg_locks ungranted`)
- Total tokens created per second
- Process heap and RSS memory consumption

