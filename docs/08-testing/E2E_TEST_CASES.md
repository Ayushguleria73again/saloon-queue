# End-to-End Test Cases (Playwright)

Verified across Mobile (`390x844` Android Chrome / iOS Safari profiles) and Desktop (`1280x800`) viewports.

## 1. Multi-Tenant & Multi-Branch End-to-End Flows
- **`E2E-01` (Salon Onboarding -> QR -> Live FIFO -> Completion)**:
  1. Owner registers salon + `"Main Branch"` via `/register`, creates `"Classic Haircut"` (`₹300`, `30m`), opens `/owner/qr`, copies booking URL.
  2. Customer (Mobile viewport) opens `/salon/{salon-slug}/main`, joins queue (`"Rahul Sharma"`, `"9876543210"`), verifies redirect to `/token/[publicId]` with `"Your token has been generated successfully!"` and `"Please wait for your turn. We will notify you when your turn is approaching."`.
  3. Owner Queue screen (`/owner/queue`, already open) receives live SSE update without refresh (`A001` visible, `Waiting = 1`).
  4. Owner clicks **`Call Next`** -> Customer page transitions live to `CALLED` (and `Cancel My Token` button disappears cleanly!).
  5. Owner adds a walk-in customer (`+ Add Walk-In` -> `A002`, `WALK_IN` badge) -> joins strict FIFO queue cleanly.
  6. Owner clicks **`Start Service`** -> `IN_SERVICE` -> **`Complete Service`** -> `COMPLETED`.
- **`E2E-02` (Two-Branch Independence)**: Create Branch 2 (`"West Branch"`) via `/owner/branches`, submit tokens at both branches simultaneously; confirm both issue `A001` cleanly and Staff assigned only to Main Branch cannot open West Branch queue.
- **`E2E-03` (Optional Push Opt-In & Denied Permission Fallback)**:
  1. Verify NO browser permission prompt triggers on landing page `/salon/{s}/{b}`.
  2. On confirmation screen, verify push opt-in card appears; test both "Dismiss/Deny" (page still updates live via SSE!) and mocked/granted Service Worker subscription flow.
- **`E2E-04` (QR Export & Print)**: Visit `/owner/qr`, verify PNG download returns valid PNG binary and printable standee renders cleanly.
- **`E2E-05` (Skipped Customer Re-queue & Self-Cancel)**:
  1. Customer cancels `WAITING` token (`CANCELLED`).
  2. Staff skips `CALLED` token (`A003`), then clicks **`Re-queue`** -> new token (`A004`) joins back of queue while `A003` remains `SKIPPED` in history.
- **`E2E-06` (Platform Admin Tenant Suspension)**: Admin logs into `/admin`, suspends Salon A; public QR page for Salon A immediately displays unavailable notice while Salon B remains unaffected.

---

## 2. Mobile Browser Compatibility Notes Documented & Verified
- **Android Chrome**: Full Web Push + Service Worker background notification + vibration + click-to-focus.
- **iOS Safari (`16.4+`)**: Web Push requires adding page to Home Screen (PWA standalone mode); standard Safari tab gracefully shows Add-to-Home-Screen hint while maintaining real-time SSE + polling updates.
- **Permission Denied**: Detected via `Notification.permission === 'denied'`; opt-in card hides or shows discreet browser-settings guide without interrupting token tracking.
