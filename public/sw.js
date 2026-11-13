self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function sanitizeTargetUrl(rawUrl) {
  if (typeof rawUrl !== "string") return "/";
  const trimmed = rawUrl.trim();
  if (/^\/(?!\/)[^\s]*$/.test(trimmed)) {
    return trimmed;
  }
  return "/";
}

self.addEventListener("push", (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { title: "SalonFlow Update", body: event.data.text() };
    }
  }

  const title =
    typeof data.title === "string" && data.title.trim()
      ? data.title.trim()
      : "SalonFlow Queue Alert";
  const body =
    typeof data.body === "string" && data.body.trim()
      ? data.body.trim()
      : "Your queue status has an update.";
  const targetUrl = sanitizeTargetUrl(data.targetUrl);
  const tag =
    typeof data.tag === "string" && data.tag.trim() ? data.tag.trim() : "salonflow-alert";
  const notificationId =
    typeof data.notificationId === "string" ? data.notificationId : undefined;

  const showPromise = self.registration.showNotification(title, {
    body,
    tag,
    renotify: true,
    data: { targetUrl, notificationId },
  });

  if (notificationId) {
    const ackPromise = fetch("/api/public/push/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notificationId, event: "DISPLAYED" }),
    }).catch(() => undefined);

    event.waitUntil(Promise.all([showPromise, ackPromise]));
    return;
  }

  event.waitUntil(showPromise);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const payloadData = event.notification.data || {};
  const targetUrl = sanitizeTargetUrl(payloadData.targetUrl);
  const fullTargetUrl = new URL(targetUrl, self.location.origin).href;

  const navigationPromise = self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then(async (clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            await client.navigate(fullTargetUrl);
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(fullTargetUrl);
      }
      return undefined;
    });

  if (payloadData.notificationId) {
    const clickAck = fetch("/api/public/push/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        notificationId: payloadData.notificationId,
        event: "CLICKED",
      }),
    }).catch(() => undefined);

    event.waitUntil(Promise.all([navigationPromise, clickAck]));
    return;
  }

  event.waitUntil(navigationPromise);
});
