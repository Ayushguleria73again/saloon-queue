# Concurrency & Performance Test Cases (`CONCURRENCY_TESTS.md`)

Executed with `Promise.all` against a real PostgreSQL connection pool.

---

## Concurrency Suite (`CT-01` – `CT-06`)

- **`CT-01` (25 Simultaneous First-of-Day Token Requests at Branch A)**:
  - Fire `25` parallel `POST .../tokens` requests with unique mobiles simultaneously.
  - **Assert**: Exact gapless permutation `A001`..`A025`, `QueueCounter.lastNumber === 25`, zero duplicate tokens, zero unhandled DB deadlocks.
- **`CT-02` (Cross-Branch Parallel Bursts)**:
  - Fire `15` parallel tokens to `Branch 1` and `15` parallel tokens to `Branch 2` simultaneously.
  - **Assert**: Both branches independently generate `A001`..`A015` without cross-branch blocking.
- **`CT-03` (10 Parallel Duplicate Mobile Submissions)**:
  - `10` concurrent requests with identical mobile & distinct `idempotencyKey` (`allowDuplicateActiveTokens = false`).
  - **Assert**: Exactly `1` succeeds (`A001`), `9` fail cleanly with `409 ACTIVE_TOKEN_EXISTS`, `QueueCounter.lastNumber === 1`.
- **`CT-04` (10 Parallel Double-Taps with Same `idempotencyKey`)**:
  - **Assert**: All return identical `publicId` and `A001`; DB contains exactly `1` token.
- **`CT-05` (Simultaneous `Call Next` by 2 Staff Members)**:
  - Queue holds `A001`, `A002` (`WAITING`). Two staff tabs execute `Call Next` concurrently.
  - **Assert**: Staff 1 gets `A001`, Staff 2 gets `A002` via `FOR UPDATE SKIP LOCKED`—never calling the same token twice!
- **`CT-06` (Simultaneous Staff `Start Service` vs Customer `Cancel`)**:
  - **Assert**: One transaction commits, the other deterministically throws `409 INVALID_STATE_TRANSITION`.

---

## API Performance & Scalability Suite (`PT-01` – `PT-03`)

- **`PT-01` (API Latency Baseline)**: Benchmark `50` concurrent branch reads (`GET /api/public/salons/[s]/[b]`) and `20` burst writes -> verify read `p95 < 80ms`, write `p95 < 150ms`.
- **`PT-02` (Single-Pass SSE Fan-Out Query Budget)**: Connect `40` SSE customer listeners to Branch A, advance queue once -> verify DB query count during broadcast is `<= 2` (zero `40x` N+1 amplification).
- **`PT-03` (`ETag` `304` Efficiency)**: Repeat polling requests with `If-None-Match` return `304` with zero JSON serialization overhead.

