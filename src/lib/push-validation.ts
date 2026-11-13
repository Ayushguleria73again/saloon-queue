const IPV4_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }

  const [a, b] = parts;
  if (a === undefined || b === undefined) return true;

  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;

  return false;
}

function isPrivateOrReservedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  ) {
    return true;
  }
  if (normalized.startsWith("::ffff:")) {
    return isPrivateOrReservedIpv4(normalized.slice("::ffff:".length));
  }
  return false;
}

/**
 * Validates Web Push endpoint URLs against SSRF targets (`UT-PSH-01`):
 * rejects `http://`, localhost/internal domains, loopback, link-local metadata
 * (`169.254.169.254`), and private RFC1918/ULA IPs.
 */
export function isValidPushEndpoint(endpoint: string): boolean {
  const trimmed = endpoint.trim();
  if (!trimmed || trimmed.length > 2048) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") {
    return false;
  }

  if (parsed.username || parsed.password) {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname) {
    return false;
  }

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    return false;
  }

  if (IPV4_PATTERN.test(hostname)) {
    return !isPrivateOrReservedIpv4(hostname);
  }
  if (hostname.includes(":")) {
    return !isPrivateOrReservedIpv6(hostname);
  }

  return hostname.includes(".");
}

/**
 * Validates Web Push subscription keys (`p256dh` >= 65 bytes, `auth` >= 16 bytes)
 * encoded as base64 or base64url.
 */
export function isValidWebPushKey(
  rawValue: string,
  minDecodedBytes: number,
  maxDecodedBytes = 128,
): boolean {
  const trimmed = rawValue.trim();
  const unpadded = trimmed.replace(/=+$/, "");
  if (!unpadded || !/^[A-Za-z0-9+/_-]+$/.test(unpadded) || unpadded.length % 4 === 1) {
    return false;
  }

  const decodedBytes = Math.floor((unpadded.length * 3) / 4);
  return decodedBytes >= minDecodedBytes && decodedBytes <= maxDecodedBytes;
}

/**
 * Rejects protocol-relative (`//evil.com`) or external URLs in notification clicks (`UT-PSH-02`).
 */
export function sanitizeNotificationTargetUrl(rawUrl: unknown): string {
  if (typeof rawUrl !== "string") return "/";
  const trimmed = rawUrl.trim();
  if (/^\/(?!\/)[^\s]*$/.test(trimmed)) {
    return trimmed;
  }
  return "/";
}

export interface FormattedPushMessage {
  title: string;
  body: string;
  targetUrl: string;
  tag: string;
}

/**
 * Builds clean, safe push notification messages from outbox event metadata (`UT-PSH-02`).
 */
export function formatPushNotificationMessage(
  eventType: string,
  payload: Record<string, unknown>,
): FormattedPushMessage {
  const tokenNumber =
    typeof payload.tokenNumber === "string" ? payload.tokenNumber : "Token";
  const branchName =
    typeof payload.branchName === "string" ? payload.branchName : "Branch";
  const customerName =
    typeof payload.customerName === "string" ? payload.customerName : "Customer";
  const maskedMobile =
    typeof payload.maskedMobile === "string" ? payload.maskedMobile : "";
  const tokenId = typeof payload.tokenId === "string" ? payload.tokenId : "";
  const peopleAhead =
    typeof payload.peopleAhead === "number" ? payload.peopleAhead : undefined;
  const estWait =
    typeof payload.estimatedWaitMinutes === "number"
      ? payload.estimatedWaitMinutes
      : undefined;
  const servicesList = Array.isArray(payload.serviceNames)
    ? payload.serviceNames.filter((s): s is string => typeof s === "string").join(", ")
    : "";

  const targetUrl = sanitizeNotificationTargetUrl(payload.targetUrl);

  switch (eventType) {
    case "NEW_TOKEN_OWNER_ALERT":
    case "NEW_TOKEN_CREATED": {
      const mobilePart = maskedMobile ? ` (${maskedMobile})` : "";
      const servicesPart = servicesList ? ` | Services: ${servicesList}` : "";
      return {
        title: "NEW CUSTOMER IN QUEUE",
        body: `Token: ${tokenNumber} | ${customerName}${mobilePart}${servicesPart} | ${branchName}`,
        targetUrl,
        tag: `owner-new-token-${tokenId || tokenNumber}`,
      };
    }
    case "OWNER_TEST_PUSH":
      return {
        title: "SalonFlow Test Notification",
        body: "SalonFlow alerts are now active on this device!",
        targetUrl: targetUrl === "/" ? "/owner/settings/notifications" : targetUrl,
        tag: "owner-test-push",
      };
    case "TOKEN_CALLED":
      return {
        title: `Token ${tokenNumber} Called`,
        body: `Your token ${tokenNumber} has been called at ${branchName}. Please proceed to the service area.`,
        targetUrl,
        tag: `token-called-${tokenId || tokenNumber}`,
      };
    case "CUSTOMER_CALLED":
      return {
        title: `Token ${tokenNumber} Called`,
        body: `${tokenNumber} (${customerName}) called at ${branchName}.`,
        targetUrl,
        tag: `owner-called-${tokenId || tokenNumber}`,
      };
    case "CUSTOMER_APPROACHING_1":
      return {
        title: "Your Turn Is Next!",
        body: `Token ${tokenNumber} is almost up${estWait !== undefined ? ` (~${estWait}m wait)` : ""}. Please stay near ${branchName}.`,
        targetUrl,
        tag: `approaching-1-${tokenId || tokenNumber}`,
      };
    case "CUSTOMER_APPROACHING_3":
      return {
        title: "Almost Your Turn",
        body: `Token ${tokenNumber} has ${peopleAhead ?? 3} customers ahead at ${branchName}.`,
        targetUrl,
        tag: `approaching-3-${tokenId || tokenNumber}`,
      };
    case "TOKEN_REQUEUED":
      return {
        title: `Re-queued as ${tokenNumber}`,
        body: `You have been placed back into the live queue at ${branchName} with token ${tokenNumber}.`,
        targetUrl,
        tag: `requeued-${tokenId || tokenNumber}`,
      };
    case "TOKEN_CONFIRMED_PUSH":
      return {
        title: `Alerts Active for ${tokenNumber}`,
        body: `You will receive live turn updates for ${tokenNumber} at ${branchName}.`,
        targetUrl,
        tag: `confirmed-${tokenId || tokenNumber}`,
      };
    case "QUEUE_DELAYED": {
      const reason =
        typeof payload.reason === "string" && payload.reason.trim()
          ? ` (${payload.reason.trim()})`
          : "";
      const waitNote =
        estWait !== undefined ? ` Estimated wait is now ~${estWait} mins.` : "";
      return {
        title: `Queue Update for ${tokenNumber}`,
        body: `Queue at ${branchName} is experiencing a delay${reason}.${waitNote}`,
        targetUrl,
        tag: `delayed-${tokenId || tokenNumber}`,
      };
    }
    default:
      return {
        title: "SalonFlow Update",
        body: `Queue update for ${tokenNumber} at ${branchName}.`,
        targetUrl,
        tag: `salonflow-${eventType.toLowerCase()}`,
      };
  }
}
