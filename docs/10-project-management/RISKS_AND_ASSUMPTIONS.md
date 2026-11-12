# Risks, Mitigations & Open Assumptions (`RISKS_AND_ASSUMPTIONS.md`)

## 1. Technical & Operational Risks

| ID | Risk | Likelihood | Impact | Mitigation |
| :---: | :--- | :---: | :---: | :--- |
| **R-01** | **iOS Safari blocks Web Push in standard browser tabs** (requires Home Screen PWA on iOS 16.4+) | High | Medium | Never rely solely on Web Push for customer turn visibility; run live SSE + `ETag` polling on ticket page and show clear iOS "Add to Home Screen" tip when detected. |
| **R-02** | **PostgreSQL RLS silently bypassed if DB connects as superuser** | Medium | High | Enforce dedicated non-superuser `app_runtime` DB role for `DATABASE_URL` in setup & deployment, plus `FORCE ROW LEVEL SECURITY` and automated `TI-05` test. |
| **R-03** | **PgBouncer session pooling conflicts with `SET LOCAL` or `LISTEN/NOTIFY`** | Medium | High | Use `SET LOCAL` inside transactions (safe in transaction mode) and separate `DIRECT_URL` solely for migrations and persistent `LISTEN/NOTIFY` listener. |
| **R-04** | **SSE thundering herd overwhelms DB when 50 customers watch one branch** | Medium | High | Single-pass snapshot computation per branch mutation (`50ms` coalescing) + memory fan-out (`PT-02` verified). |
| **R-05** | **Shared Salon Wi-Fi triggers rate-limit false positives** | High | Medium | Generous per-IP+branch ceiling (`20 / 10m`) paired with per-mobile limits (`3 / 15m`), honeypot field, and duplicate active token guard. |
| **R-06** | **Budget Android OEMs aggressively kill Service Workers in background** | High | Low | Reconcile state immediately on `visibilitychange`/`online`; show honest `ACCEPTED_BY_PROVIDER` vs `ACKNOWLEDGED` status in delivery logs. |
| **R-07** | **Abandoned `WAITING` tokens pile up across business days** | Medium | Medium | Scope active queries strictly by `businessDate` and run automated end-of-day expiry worker. |

---

## 2. Documented Decisions & Remaining Open Questions (`DECISIONS.md`)

1. **`ADR-009`..`ADR-012` (Resolved Final Product Decisions)**: Skipped re-queue creates a new sequence at back of queue preserving original history; customer self-cancel allowed ONLY in `WAITING` (branch-configurable); Walk-In entry included in MVP (`WALK_IN` source); Railway selected as primary Docker+PostgreSQL hosting platform.
2. **`ADR-015` (Self-Serve Tenant Activation)**: New salons become `ACTIVE` immediately upon registration (toggleable to `PENDING` admin-approval mode via `REQUIRE_ADMIN_TENANT_APPROVAL`).
3. **Indian Mobile Baseline**: Customer phone validation defaults to 10-digit Indian numbers (`^[6-9]\d{9}$`, `+91`).

