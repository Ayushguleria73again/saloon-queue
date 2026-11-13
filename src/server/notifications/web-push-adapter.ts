import { sendNotification, WebPushError } from "web-push";
import { getEnv } from "@/lib/env";

export interface PushSendRequest {
  subscription: {
    endpoint: string;
    p256dh: string;
    auth: string;
  };
  payload: {
    title: string;
    body: string;
    targetUrl: string;
    tag: string;
    notificationId?: string;
  };
  ttlSeconds?: number;
  urgency?: "very-low" | "low" | "normal" | "high";
}

export interface PushSendResult {
  ok: boolean;
  statusCode: number;
  errorCode?: string;
  errorMessage?: string;
  permanentUnsubscribe?: boolean;
  permanentInvalid?: boolean;
  retryable?: boolean;
  durationMs: number;
}

export interface PushTransport {
  send(req: PushSendRequest): Promise<PushSendResult>;
}

/**
 * Production Web Push adapter wrapping `web-push` with VAPID JWT credentials and a 5s timeout.
 */
export class VapidWebPushTransport implements PushTransport {
  async send(req: PushSendRequest): Promise<PushSendResult> {
    const startedAt = Date.now();
    const env = getEnv();

    if (!env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
      return {
        ok: false,
        statusCode: 500,
        errorCode: "VAPID_NOT_CONFIGURED",
        errorMessage: "VAPID keys are not configured in environment.",
        permanentInvalid: true,
        durationMs: Date.now() - startedAt,
      };
    }

    try {
      const response = await sendNotification(
        {
          endpoint: req.subscription.endpoint,
          keys: {
            p256dh: req.subscription.p256dh,
            auth: req.subscription.auth,
          },
        },
        JSON.stringify(req.payload),
        {
          TTL: req.ttlSeconds ?? 60,
          urgency: req.urgency ?? "high",
          timeout: 5000,
          vapidDetails: {
            subject: env.VAPID_SUBJECT,
            publicKey: env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
            privateKey: env.VAPID_PRIVATE_KEY,
          },
        },
      );

      return {
        ok: true,
        statusCode: response.statusCode || 201,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      const durationMs = Date.now() - startedAt;

      if (error instanceof WebPushError) {
        const status = error.statusCode || 500;
        if (status === 404 || status === 410) {
          return {
            ok: false,
            statusCode: status,
            errorCode: status === 410 ? "SUBSCRIPTION_GONE" : "SUBSCRIPTION_NOT_FOUND",
            errorMessage: error.message.slice(0, 300),
            permanentUnsubscribe: true,
            durationMs,
          };
        }

        if (status === 400 || status === 401 || status === 403) {
          return {
            ok: false,
            statusCode: status,
            errorCode: `HTTP_${status}`,
            errorMessage: error.message.slice(0, 300),
            permanentInvalid: true,
            durationMs,
          };
        }

        return {
          ok: false,
          statusCode: status,
          errorCode: `HTTP_${status}`,
          errorMessage: error.message.slice(0, 300),
          retryable: true,
          durationMs,
        };
      }

      const message = error instanceof Error ? error.message : "Network error";
      return {
        ok: false,
        statusCode: 503,
        errorCode: "NETWORK_ERROR",
        errorMessage: message.slice(0, 300),
        retryable: true,
        durationMs,
      };
    }
  }
}

export const defaultPushTransport = new VapidWebPushTransport();
