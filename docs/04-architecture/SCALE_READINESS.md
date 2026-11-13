# SalonFlow SaaS — Scale Readiness & Horizontal Clustered Roadmap

**Document Version**: 1.0.0  
**Status**: Architectural Specification for Clustered Horizontal Scaling  
**Scope**: Multi-Instance Real-Time Streams, Distributed Rate Limiting, and Decoupled Background Workers  

---

## 1. Single-Instance Baseline vs. Scale Trigger Thresholds

SalonFlow is engineered as a high-performance **modular monolith**. In its current single-node production deployment, verified benchmark metrics show:

- **Single-Node Capacity Baseline**:
  - Sustained Public Reads: **p95 < 25ms** (cached in-memory catalog).
  - Burst Token Creation: **p95 < 135ms** (atomic transaction with advisory locks).
  - Concurrent Real-Time SSE Listeners: **Up to 500 concurrent connections** per Node.js process without event loop lag.
  - Notification Outbox Throughput: **Up to 500 Web Push dispatches per minute**.
  - In-Memory Rate Limiting: **< 0.1ms per check** across 10,000 active client IP/mobile buckets.

### Scale Migration Triggers

The system should remain on the simplified single-instance topology until one of the following production metrics is sustained:

| Metric | Single-Instance Ceiling | Horizontal Clustered Architecture Required |
|---|---|---|
| **Active Salons** | 1 to 15 salons | 15+ salons |
| **Daily Token Volume** | < 2,000 tokens/day | > 2,000 tokens/day |
| **Concurrent SSE Connections** | < 500 open streams | > 500 open streams |
| **Application Containers** | 1 container | 2+ containers behind load balancer |

---

## 2. Outstanding Scale-Readiness Tasks

### Task 1: Multi-Instance Real-Time SSE Fan-Out
- **Challenge**:
  - In horizontal deployments with multiple application instances behind a round-robin load balancer, an operator triggering "Call Next" on Instance A must notify customer browsers connected to Instance B.
- **Current Architectural Foundation**:
  - `src/server/realtime/hub.ts` already contains native support for PostgreSQL `LISTEN` and `NOTIFY`:
    ```ts
    if (process.env.REALTIME_TRANSPORT === "pg-listen") {
      await client.query("LISTEN salonflow_queue_events");
      client.on("notification", (msg) => {
        const parsed = JSON.parse(msg.payload);
        this.scheduleBranchProjection(parsed.organizationId, parsed.branchId);
      });
    }
    ```
- **Scale Implementation Plan**:
  1. Set `REALTIME_TRANSPORT="pg-listen"` and `DIRECT_URL` in container environment variables.
  2. For ultra-high volume (>50 active branches), replace PostgreSQL LISTEN with **Redis Pub/Sub** via `ioredis` to prevent exhausting PostgreSQL connection limits.

---

### Task 2: Distributed Sliding-Window Rate Limiting
- **Challenge**:
  - `MemorySlidingWindowRateLimiter` (`src/server/security/rate-limiter.ts`) tracks IP and mobile request counts in local container RAM. When traffic is distributed across $N$ instances, a client can theoretically consume $N \times \text{limit}$ requests.
- **Scale Implementation Plan**:
  1. **Option A (Perimeter Nginx Throttling)**:
     - Configure Nginx `limit_req_zone`:
       ```nginx
       limit_req_zone $binary_remote_addr zone=public_intake:10m rate=5r/s;
       location /api/public/salons/ {
         limit_req zone=public_intake burst=10 nodelay;
         proxy_pass http://salonflow_upstream;
       }
       ```
  2. **Option B (Redis Sliding Window)**:
     - Implement `RedisSlidingWindowRateLimiter` implementing the existing `RateLimiter` TypeScript interface using atomic Redis sorted sets:
       ```lua
       -- KEYS[1]: bucket key, ARGV[1]: windowStart, ARGV[2]: nowMs, ARGV[3]: limit, ARGV[4]: windowTtl
       redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[1])
       local currentCount = redis.call('ZCARD', KEYS[1])
       if currentCount < tonumber(ARGV[3]) then
         redis.call('ZADD', KEYS[1], ARGV[2], ARGV[2])
         redis.call('EXPIRE', KEYS[1], ARGV[4])
         return 1
       else
         return 0
       end
       ```

---

### Task 3: Decoupled Standalone Outbox Workers
- **Challenge**:
  - The background outbox runner currently executes in-process via `setInterval` (`src/server/jobs/runner.ts`). Under heavy web push dispatch loads, HTTP request timeouts could steal event-loop ticks from HTTP request handling.
- **Scale Implementation Plan**:
  1. Set `OUTBOX_WORKER_ENABLED="false"` on web-serving Next.js containers.
  2. Spawn a dedicated worker container:
     ```yaml
     worker:
       build: .
       command: ["node", "scripts/standalone-outbox-worker.js"]
       environment:
         - OUTBOX_WORKER_ENABLED=true
         - OUTBOX_POLL_INTERVAL_MS=1000
     ```
  3. Migrate to a persistent queue (BullMQ / Dragonfly) if notification throughput exceeds 2,000 pushes/minute.
