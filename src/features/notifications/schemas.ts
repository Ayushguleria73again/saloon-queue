import { z } from "zod";
import { isValidPushEndpoint, isValidWebPushKey } from "@/lib/push-validation";
import { sanitizePlainText } from "@/features/public-intake/schemas";

export const webPushSubscriptionPayloadSchema = z
  .object({
    endpoint: z
      .string()
      .trim()
      .max(2048, "Push endpoint URL is too long.")
      .refine(isValidPushEndpoint, {
        message: "Push endpoint must be a valid public HTTPS URL.",
      }),
    keys: z
      .object({
        p256dh: z
          .string()
          .trim()
          .refine((val) => isValidWebPushKey(val, 65), {
            message: "Invalid p256dh Web Push public key.",
          }),
        auth: z
          .string()
          .trim()
          .refine((val) => isValidWebPushKey(val, 16), {
            message: "Invalid auth Web Push secret.",
          }),
      })
      .strict(),
  })
  .strict();

export const createOwnerPushSubscriptionSchema = webPushSubscriptionPayloadSchema
  .extend({
    branchId: z.string().uuid("Invalid branch identifier.").nullable().optional(),
    deviceLabel: z
      .string()
      .transform(sanitizePlainText)
      .pipe(z.string().max(120))
      .optional(),
    preferences: z
      .object({
        newToken: z.boolean().optional().default(true),
        longQueue: z.boolean().optional().default(true),
        testAlerts: z.boolean().optional().default(true),
      })
      .strict()
      .optional(),
  })
  .strict();

export type CreateOwnerPushSubscriptionInput = z.infer<
  typeof createOwnerPushSubscriptionSchema
>;

export const deleteOwnerPushSubscriptionSchema = z
  .object({
    id: z.string().uuid().optional(),
    endpoint: z.string().trim().max(2048).optional(),
  })
  .strict()
  .refine((val) => Boolean(val.id || val.endpoint), {
    message: "Provide a subscription id or endpoint to unsubscribe.",
  });

export const ownerTestPushSchema = z
  .object({
    subscriptionId: z.string().uuid().optional(),
  })
  .strict();

export const createCustomerPushSubscriptionSchema = webPushSubscriptionPayloadSchema
  .extend({
    deviceLabel: z
      .string()
      .transform(sanitizePlainText)
      .pipe(z.string().max(120))
      .optional(),
  })
  .strict();

export type CreateCustomerPushSubscriptionInput = z.infer<
  typeof createCustomerPushSubscriptionSchema
>;

export const deleteCustomerPushSubscriptionSchema = z
  .object({
    endpoint: z.string().trim().max(2048).optional(),
  })
  .strict();

export const publicPushAckSchema = z
  .object({
    notificationId: z.string().uuid("Invalid notification identifier."),
    event: z.enum(["DISPLAYED", "CLICKED"]).optional().default("DISPLAYED"),
  })
  .strict();
