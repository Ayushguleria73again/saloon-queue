# Service Worker & Web Push Setup (`SERVICE_WORKER_SETUP.md`)

## 1. Service Worker File (`public/sw.js`)

Served directly from origin root (`/sw.js`) with HTTP header `Cache-Control: no-cache, no-store, must-revalidate` so browser updates apply promptly without stale worker lock-in.

### Core Responsibilities of `public/sw.js`
1. **`install` & `activate`**: `self.skipWaiting()` / `clients.claim()` cleanly on activation.
2. **`push` Event Handler**:
   - Parses JSON push payload `{ title, body, targetUrl, tag, notificationId, ackToken }`.
   - Calls `self.registration.showNotification(title, { body, icon: '/icons/icon-192.png', badge: '/icons/badge-72.png', tag, renotify: true, data: { targetUrl, notificationId } })`.
   - Optionally fires best-effort delivery receipt (`fetch('/api/public/push/ack', ...)` if `notificationId` provided) to record `ACKNOWLEDGED` telemetry!
3. **`notificationclick` Event Handler**:
   - Closes the notification (`event.notification.close()`).
   - Validates `targetUrl` strictly starts with `/` (same-origin relative path—never opens untrusted external URLs!).
   - Searches `clients.matchAll({ type: 'window', includeUncontrolled: true })`: focuses existing matching SalonFlow tab/PWA window and navigates it, or opens a new window via `clients.openWindow(targetUrl)`.
4. **`pushsubscriptionchange` Handler**:
   - Handles browser-initiated subscription key rotation gracefully where supported.

---

## 2. Browser-Specific Push Behavior & Limitations

| Platform / Browser | Support | Special Behavior Documented |
| :--- | :---: | :--- |
| **Android Chrome / Edge / Brave** | ✅ Full | Background push works even when Chrome is closed. |
| **Desktop Chrome / Firefox / Edge** | ✅ Full | Works in background while browser process runs. |
| **iOS / iPadOS Safari (`16.4+`)** | ⚠️ Conditional | Web Push **only works when added to Home Screen (standalone PWA)**! Standard Safari tabs do not expose `PushManager`. UI detects iOS non-standalone and displays an unobtrusive Add-to-Home-Screen guide while live SSE still works. |
| **Incognito / Private Browsing** | ❌ Blocked | Browsers disable Push API in private windows; gracefully hidden in UI. |
| **Permission Denied (`denied`)** | ❌ Blocked | Cannot re-prompt programmatically; show subtle browser settings instruction if user taps Alerts toggle. |

