# Unit Test Cases

## 1. Normalization & Business Date
- `UT-PHN-01..04`: Indian 10-digit normalization (`+91 98765-43210` -> `9876543210`, `09876543210` -> `9876543210`, rejects `5876543210` and short/alpha inputs).
- `UT-DAT-01..03`: Branch timezone `businessDate` calculation (`Asia/Kolkata` vs `America/New_York`, rollover at `dayResetTime = "04:00"` vs `"00:00"`).

## 2. Strict FIFO & State Machine (`validateTokenTransition`)
- `UT-STM-01`: Allows `WAITING -> CALLED | IN_SERVICE | CANCELLED`.
- `UT-STM-02`: Allows `CALLED -> IN_SERVICE | SKIPPED | CANCELLED | NO_SHOW`.
- `UT-STM-03`: Allows `IN_SERVICE -> COMPLETED | CANCELLED`.
- `UT-STM-04`: Allows `SKIPPED -> NO_SHOW | CANCELLED`; rejects manual reordering or jumping out of terminal states (`COMPLETED`, `CANCELLED`, `NO_SHOW`).
- `UT-STM-05`: Self-cancellation guard allows customer cancel strictly when `status === 'WAITING'` and branch `allowCustomerCancel === true`, rejecting `CALLED` and `IN_SERVICE`.

## 3. Waiting Time Engine (`calculateBranchWaitTimes`)
- `UT-WT-01`: Empty queue -> `0 mins`.
- `UT-WT-02`: Strict FIFO `sequenceNumber ASC` assigns monotonically accurate station completion times across `activeStationsCount = 1, 2, 3`.
- `UT-WT-03`: `CANCELLED`, `SKIPPED`, and `NO_SHOW` tokens do not add wait minutes to `WAITING` tokens ahead/behind.
- `UT-WT-04`: Overdue `IN_SERVICE` floors remaining duration at `3 mins`; historical overrun clamp stays bounded `[0.85, 1.35]`.

## 4. Push Validation & Security Helpers
- `UT-PSH-01`: Rejects `http://` push endpoints, `127.0.0.1`, `169.254.169.254`, `10.0.0.1`, and malformed `p256dh`/`auth` base64 strings.
- `UT-PSH-02`: Notification message formatter builds clean safe titles/bodies and validates same-origin relative `targetUrl` paths.
