# Real-Time Queue Updates Architecture

## 1. Evaluation of Real-Time Options

| Criterion | Server-Sent Events (SSE) | WebSockets | Polling |
| :--- | :--- | :--- | :--- |
| **Directionality** | Server -> Client (Ideal: all mutations are explicit HTTP calls) | Bidirectional (Overkill) | Request/Response |
| **Next.js Monolith Fit** | **Native** (`ReadableStream` over HTTP) | Requires separate custom WS server or paid Pusher/Ably | **Native** |
| **Update Latency** | **Instant (< 500ms)** | Instant (< 200ms) | 5s–10s lag |
| **Scaling Cost** | **₹0** (In-process + PG `LISTEN/NOTIFY` via `DIRECT_URL`) | External broker / sticky LB complexity | **₹0** (but higher DB load if frequent) |
| **Mobile Reconnect** | Native browser `EventSource` retry | Custom heartbeat & backoff | Stateless |

### Distinction from Web Push
- **Real-Time (SSE + Polling)** updates an **actively open screen** (Owner live dashboard, Customer live ticket tab) instantly without page reloads.
- **Web Push (Service Workers)** wakes up a device or shows OS notifications when the browser tab is **backgrounded or closed**.
- Both systems run independently and complement each other.

---

## 2. Selected Architecture: Tenant/Branch-Scoped SSE + `ETag` Polling Fallback

1. **Tenant & Branch Event Channels**:
   - Channel key: `branch:{organizationId}:{branchId}`.
   - **Single-Instance Scope**: In-memory Node `EventEmitter` is **strictly limited to single-container deployments**.
   - **Multi-Instance Horizontal Scaling**: When running `> 1` application instance (`REALTIME_TRANSPORT=pg-listen`), use **PostgreSQL `LISTEN/NOTIFY`** over a dedicated non-pooled `DIRECT_URL` client (or Redis Pub/Sub if scaled beyond Postgres limits) so queue updates from Instance A immediately stream to clients connected to Instance B.
2. **Thundering-Herd Prevention (Single-Pass Projection)**:
   - On branch queue mutation (`TOKEN_CREATED`, `TOKEN_CALLED`, `TOKEN_STATUS_CHANGED`, `TOKEN_REQUEUED`, `BRANCH_SETTINGS_UPDATED`), coalesce rapid bursts (`50ms` window) and run **1 indexed DB query** to recompute FIFO positions and wait estimates for all active tokens in that branch.
   - Distribute each subscribed customer stream **only** its own sanitized slice (`status`, `queuePosition`, `peopleAhead`, `estimatedWaitMinutes`, `updatedAt`)—zero cross-customer PII leakage and zero `M x` DB query fan-out!
3. **Endpoints**:
   - `GET /api/owner/branches/[branchId]/queue/events`: Auth + branch access checked; `25s` keep-alive ping, `Last-Event-ID` support.
   - `GET /api/public/tokens/[publicId]/events`: Validates `publicId`, streams sanitized updates for that token only; auto-closes cleanly when token reaches terminal state (`COMPLETED`, `CANCELLED`, `NO_SHOW`).
4. **Reconnection, Resynchronization & `ETag` `304` Fallback**:
   - Client hook `useRealtimeStream` listens to `EventSource.onopen` (after reconnect), `document.visibilitychange` (`visible`), and `window.online` to trigger an immediate state reconciliation `fetch()` so missed events during mobile network drops never leave stale queues!
   - If `EventSource` fails `3` consecutive times (proxy restriction or serverless timeout), degrades to **visibility-aware polling (`5s` active / paused hidden)** using `If-None-Match` (`ETag`) returning lightweight `304 Not Modified` when queue version is unchanged.
   - **Strict Separation from Web Push**: SSE updates live open browser tabs only; background/closed-tab alerts rely exclusively on Web Push + `/sw.js`.
