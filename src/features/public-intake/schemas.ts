import { z } from "zod";
import { tryNormalizeIndianMobile } from "@/lib/phone";

export function sanitizePlainText(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, " ").trim();
}

export const publicCreateTokenSchema = z
  .object({
    fullName: z
      .string()
      .transform(sanitizePlainText)
      .pipe(
        z
          .string()
          .min(2, "Please enter your full name (at least 2 characters).")
          .max(80, "Name must be at most 80 characters."),
      ),
    mobileNumber: z
      .string()
      .transform((val) => tryNormalizeIndianMobile(val) ?? "")
      .refine((val) => /^[6-9]\d{9}$/.test(val), {
        message: "Enter a valid 10-digit Indian mobile number starting with 6–9.",
      }),
    serviceIds: z
      .array(z.string().uuid("Invalid service identifier."))
      .min(1, "Please select at least 1 service.")
      .max(15, "You can select at most 15 services at once.")
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "Duplicate services are not allowed.",
      }),
    notes: z
      .string()
      .transform(sanitizePlainText)
      .pipe(z.string().max(300, "Notes must be at most 300 characters."))
      .optional(),
    idempotencyKey: z.string().uuid("Invalid submission key.").optional(),
    qrToken: z.string().trim().max(128).optional(),
    website: z.string().max(120).optional().default(""),
  })
  .strict();

export type PublicCreateTokenInput = z.infer<typeof publicCreateTokenSchema>;

export const publicTokenIdParamSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{12,64}$/, "Invalid token identifier.");

export const publicCancelTokenSchema = z
  .object({
    reason: z
      .string()
      .transform(sanitizePlainText)
      .pipe(z.string().max(200, "Reason must be at most 200 characters."))
      .optional(),
  })
  .strict();

export type PublicCancelTokenInput = z.infer<typeof publicCancelTokenSchema>;
