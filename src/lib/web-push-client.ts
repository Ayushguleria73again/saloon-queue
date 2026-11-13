export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isWebPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function isIosNonStandaloneBrowser(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }

  const ua = navigator.userAgent || "";
  const isIos = /iPad|iPhone|iPod/i.test(ua);
  if (!isIos) {
    return false;
  }

  const standaloneMedia =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches;
  const navigatorStandalone =
    "standalone" in navigator &&
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);

  return !standaloneMedia && !navigatorStandalone;
}

export type BrowserPushSubscribeOutcome =
  | { status: "subscribed"; endpoint: string; p256dh: string; auth: string }
  | { status: "denied"; permission: NotificationPermission }
  | { status: "unsupported" }
  | { status: "error"; message: string };

/**
 * Explicitly requests permission on user action, registers `/sw.js`, and subscribes
 * via PushManager using the server VAPID public key. Never call outside click handlers.
 */
export async function requestAndSubscribeWebPush(
  vapidPublicKey: string,
): Promise<BrowserPushSubscribeOutcome> {
  if (!isWebPushSupported()) {
    return { status: "unsupported" };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { status: "denied", permission };
  }

  const registration = await navigator.serviceWorker.register("/sw.js", {
    scope: "/",
  });
  await navigator.serviceWorker.ready;

  const existingSub = await registration.pushManager.getSubscription();
  const pushSub =
    existingSub ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    }));

  const raw = pushSub.toJSON();
  if (!raw.endpoint || !raw.keys?.p256dh || !raw.keys?.auth) {
    return {
      status: "error",
      message: "Incomplete browser push subscription returned by device.",
    };
  }

  return {
    status: "subscribed",
    endpoint: raw.endpoint,
    p256dh: raw.keys.p256dh,
    auth: raw.keys.auth,
  };
}

export async function getActiveBrowserPushEndpoint(): Promise<string | null> {
  if (!isWebPushSupported()) {
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    if (!registration) {
      return null;
    }
    const existing = await registration.pushManager.getSubscription();
    return existing?.endpoint ?? null;
  } catch {
    return null;
  }
}
