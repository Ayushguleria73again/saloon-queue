# Waiting Time Estimation Engine

## 1. Purpose & UX Framing

Provide every waiting customer and owner dashboard row with a realistic **approximate** waiting time. Because actual haircut/facial durations vary by customer, the UI explicitly presents estimates as approximations (e.g., `"~25 mins (approx.)"`), never guaranteed appointment slots.

---

## 2. Inputs

For a branch on active `businessDate`:
1. **`activeStationsCount`** (`K >= 1` from `SalonSettings`, representing active chairs/stylists at that branch).
2. **`inServiceTokens`**: Tokens currently `IN_SERVICE`, ordered by `serviceStartedAt ASC`.
3. **`calledTokens`**: Tokens in `CALLED`, ordered by `calledAt ASC, sequenceNumber ASC`.
4. **`waitingTokens`**: Tokens in `WAITING`, ordered by `sequenceNumber ASC`.
5. **Service Durations & Historical Blend**:
   - Each token carries `totalDurationMinutes` (sum of `BranchService` / `Service` durations at booking).
   - Optional lightweight **historical duration blend**: if a branch has `>= 20` completed tokens for a service pattern in the last 30 days, compute `avgOverrunFactor = clamp(actualDuration / estimatedDuration, 0.85, 1.35)` (default `1.0` until enough branch history exists!).

---

## 3. Earliest-Free-Station Simulation Algorithm

Let `stations = Array(K).fill(0)` track minutes from `now` until each station is free.

1. **Seed Active `IN_SERVICE` Stations**:
   - For `idx` from `0` to `min(inServiceTokens.length, K) - 1`:
     - `elapsedMins = (now - token.serviceStartedAt) / 60000`
     - `expectedMins = Math.round(token.totalDurationMinutes * overrunFactor)`
     - `remainingMins = Math.max(3, expectedMins - elapsedMins)` *(3-min floor prevents showing `0m` while finishing up)*
     - `stations[idx] = Math.round(remainingMins)`
   - Any overflow `IN_SERVICE` tokens beyond `K` are treated as already occupying earliest free stations (`stations[minIdx] += remainingMins`).
2. **Schedule `CALLED` Tokens Ahead of `WAITING`**:
   - For each `CALLED` token:
     - Find `minIdx` with smallest `stations[minIdx]`.
     - For display on the `CALLED` customer's own ticket, wait = `0 mins ("Your Turn Now")`.
     - Advance station: `stations[minIdx] += Math.round(token.totalDurationMinutes * overrunFactor) + bufferMinutes`.
3. **Schedule `WAITING` Tokens in Strict FIFO (`sequenceNumber ASC`)**:
   - Let `peopleAhead = calledTokens.length`.
   - For each `w` in `waitingTokens`:
     - Find `minIdx` with smallest `stations[minIdx]`.
     - Assign `w.estimatedWaitMinutes = stations[minIdx]` and `w.peopleAhead = peopleAhead`, `w.queuePosition = peopleAhead + 1`.
     - Advance station: `stations[minIdx] += Math.round(w.totalDurationMinutes * overrunFactor) + bufferMinutes`.
     - Increment `peopleAhead += 1`.

**Scalability Benefit**: This entire loop runs in `O(N * K)` in `< 0.5ms` in memory across all active branch tokens, generating every token's position & wait estimate in **one single pass** for SSE broadcasting!

---

## 4. Edge Cases Handled
- **Zero `WAITING` and empty chairs**: Estimate for a newly joining customer = `0 mins` (`"No wait — step right up!"`).
- **Overdue `IN_SERVICE` (> estimated duration)**: Floored at `3 mins` remaining so estimates never go negative.
- **Branch Settings Changed Mid-Day (`activeStationsCount` updated `1 -> 2`)**: Next SSE broadcast immediately recalculates and pushes updated estimates across all active tickets.

