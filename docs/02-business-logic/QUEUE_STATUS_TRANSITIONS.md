# Queue Status Transitions & State Machine

## 1. Status Enumeration (`TokenStatus`)

| Status | Active? | Description |
| :--- | :---: | :--- |
| `WAITING` | Yes | Issued in strict FIFO queue; waiting to be called |
| `CALLED` | Yes | Selected by `Call Next`; customer notified to approach chair |
| `IN_SERVICE` | Yes | Customer currently receiving service |
| `COMPLETED` | No (Terminal) | Service finished cleanly |
| `SKIPPED` | No (Non-blocking) | Customer unavailable when called; skipped so queue advances |
| `CANCELLED` | No (Terminal) | Cancelled by owner/staff or customer self-cancel |
| `NO_SHOW` | No (Terminal) | Customer never showed up / timed out after call or skip |

---

## 2. State Transition Diagram

```text
┌─────────┐   Call Next    ┌────────┐   Start Service   ┌────────────┐   Complete   ┌───────────┐
│ WAITING ├───────────────►│ CALLED ├──────────────────►│ IN_SERVICE ├─────────────►│ COMPLETED │
└────┬────┘                └──┬─┬─┬─┘                   └─────┬──────┘              └───────────┘
     │                        │ │ │                           │
     │ Cancel                 │ │ │ Skip                      │ Cancel (Rare abort)
     │                        │ │ ▼                           │
     │                        │ │ ┌─────────┐   Mark No-Show  │
     │                        │ │ │ SKIPPED ├────────┐        │
     │                        │ │ └────┬────┘        ▼        │
     │                        │ │      │ Cancel  ┌─────────┐  │
     │                        │ └──────┼────────►│ NO_SHOW │  │
     │                        │        │         └─────────┘  │
     │                        ▼ Cancel ▼                      ▼
     └───────────────────────►┌───────────┐◄──────────────────┘
                              │ CANCELLED │
                              └───────────┘
```

*(Note: Direct `WAITING -> IN_SERVICE` may also be permitted as a staff shortcut when calling a customer standing right beside an open chair (`START_SERVICE`), recording `calledAt = COALESCE(calledAt, NOW())` alongside `serviceStartedAt`.)*

---

## 3. Transition Matrix

| From \ To | `WAITING` | `CALLED` | `IN_SERVICE` | `COMPLETED` | `SKIPPED` | `CANCELLED` | `NO_SHOW` |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **`WAITING`** | ❌ | ✅ (`Call Next`) | ✅ (Shortcut) | ❌ | ❌ | ✅ (Staff / Customer*) | ❌ |
| **`CALLED`** | ❌ | ❌ | ✅ (`Start Service`) | ❌ | ✅ (`Skip`) | ✅ (Staff ONLY) | ✅ (`No-Show`) |
| **`IN_SERVICE`** | ❌ | ❌ | ❌ | ✅ (`Complete`) | ❌ | ✅ (Staff abort) | ❌ |
| **`SKIPPED`** | ❌** | ❌ | ❌ | ❌ | ❌ | ✅ (Staff) | ✅ (`No-Show`) |
| **`COMPLETED`** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **`CANCELLED`** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **`NO_SHOW`** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

*\*Customer self-cancellation is allowed **ONLY while status is `WAITING`** and only when branch `SalonSettings.allowCustomerCancel === true`. Once a token becomes `CALLED` or `IN_SERVICE`, customer self-cancellation is strictly disabled (`409`). Every cancellation is logged in `AuditLog`.*  
*\*\*Skipped Customer Re-queue (`ADR-009`): Original `SKIPPED` token stays immutable in history; clicking **Re-queue** atomically generates a **new** FIFO sequence token (`requeuedFromTokenId`) placed at the back of `WAITING`.*
