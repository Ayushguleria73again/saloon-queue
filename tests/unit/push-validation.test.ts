import { describe, expect, it } from "vitest";
import { createOwnerPushSubscriptionSchema } from "@/features/notifications/schemas";
import {
  formatPushNotificationMessage,
  isValidPushEndpoint,
  isValidWebPushKey,
  sanitizeNotificationTargetUrl,
} from "@/lib/push-validation";
import { computeRetryBackoffMs } from "@/server/notifications/outbox-worker";

describe("Phase 11 Push Validation, Formatting & Backoff (UT-PSH-01..02)", () => {
  const validP256dh = Buffer.alloc(65, 4).toString("base64url");
  const validAuth = Buffer.alloc(16, 7).toString("base64url");

  it("UT-PSH-01: rejects http://, loopback, cloud metadata, RFC1918 private IPs, and malformed keys", () => {
    const blockedEndpoints = [
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://127.0.0.1/push",
      "https://169.254.169.254/latest/meta-data",
      "https://10.0.0.1/internal",
      "https://192.168.1.50/push",
      "https://172.16.0.10/push",
      "https://[::1]/push",
      "https://localhost/push",
      "https://metadata.internal/push",
      "not-a-url",
    ];

    for (const endpoint of blockedEndpoints) {
      expect(isValidPushEndpoint(endpoint)).toBe(false);
    }

    expect(
      isValidPushEndpoint("https://fcm.googleapis.com/fcm/send/valid-token-123"),
    ).toBe(true);
    expect(
      isValidPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc"),
    ).toBe(true);

    // Key byte-length validation
    expect(isValidWebPushKey("short", 65)).toBe(false);
    expect(isValidWebPushKey("not!base64*", 16)).toBe(false);
    expect(isValidWebPushKey(validP256dh, 65)).toBe(true);
    expect(isValidWebPushKey(validAuth, 16)).toBe(true);

    expect(
      createOwnerPushSubscriptionSchema.safeParse({
        endpoint: "https://fcm.googleapis.com/fcm/send/device-1",
        keys: { p256dh: validP256dh, auth: validAuth },
        deviceLabel: "Counter Chrome",
      }).success,
    ).toBe(true);
  });

  it("UT-PSH-02: formats safe notification payloads and sanitizes targetUrl against open redirects", () => {
    expect(sanitizeNotificationTargetUrl("/owner/queue?branchId=123")).toBe(
      "/owner/queue?branchId=123",
    );
    expect(sanitizeNotificationTargetUrl("https://evil.example.com")).toBe("/");
    expect(sanitizeNotificationTargetUrl("//evil.example.com/phish")).toBe("/");
    expect(sanitizeNotificationTargetUrl("javascript:alert(1)")).toBe("/");

    const ownerAlert = formatPushNotificationMessage("NEW_TOKEN_OWNER_ALERT", {
      tokenId: "tok-1",
      tokenNumber: "A014",
      customerName: "Rahul Sharma",
      maskedMobile: "******3210",
      serviceNames: ["Haircut", "Beard Trim"],
      branchName: "Main Branch",
      targetUrl: "/owner/queue?branchId=b1",
    });
    expect(ownerAlert.title).toBe("NEW CUSTOMER IN QUEUE");
    expect(ownerAlert.body).toContain("A014");
    expect(ownerAlert.body).toContain("Rahul Sharma");
    expect(ownerAlert.body).toContain("******3210");
    expect(ownerAlert.body).toContain("Haircut, Beard Trim");
    expect(ownerAlert.targetUrl).toBe("/owner/queue?branchId=b1");

    const poisoned = formatPushNotificationMessage("TOKEN_CALLED", {
      tokenNumber: "A014",
      branchName: "Main Branch",
      targetUrl: "https://attacker.tld/steal",
    });
    expect(poisoned.targetUrl).toBe("/");

    const delayed = formatPushNotificationMessage("QUEUE_DELAYED", {
      tokenNumber: "A014",
      branchName: "Main Branch",
      reason: "Staff lunch break",
      estimatedWaitMinutes: 35,
      targetUrl: "/salon/aura/main/token/tok1",
    });
    expect(delayed.title).toContain("A014");
    expect(delayed.body).toContain("Staff lunch break");
    expect(delayed.body).toContain("~35 mins");
  });

  it("computes documented exponential backoff intervals (15s, 60s, 300s, 900s)", () => {
    expect(computeRetryBackoffMs(1, 1)).toBe(15_000);
    expect(computeRetryBackoffMs(2, 1)).toBe(60_000);
    expect(computeRetryBackoffMs(3, 1)).toBe(300_000);
    expect(computeRetryBackoffMs(4, 1)).toBe(900_000);
    expect(computeRetryBackoffMs(5, 1)).toBe(900_000);
  });
});
