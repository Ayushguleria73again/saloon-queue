import { z } from "zod";
import { tryNormalizeIndianMobile } from "@/lib/phone";
import { sanitizePlainText } from "@/features/public-intake/schemas";

export const walkInTokenSchema = z
  .object({
    fullName: z
      .string()
      .transform(sanitizePlainText)
      .pipe(
        z
          .string()
          .min(2, "Customer name must be at least 2 characters.")
          .max(80, "Customer name must be at most 80 characters."),
      ),
    mobileNumber: z
      .string()
      .transform((val) => tryNormalizeIndianMobile(val) ?? "")
      .refine((val) => /^[6-9]\d{9}$/.test(val), {
        message: "Enter a valid 10-digit Indian mobile number starting with 6–9.",
      }),
    serviceIds: z
      .array(z.string().uuid("Invalid service identifier."))
      .min(1, "Select at least 1 service.")
      .max(15, "Select at most 15 services at once.")
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "Duplicate services are not allowed.",
      }),
    notes: z
      .string()
      .transform(sanitizePlainText)
      .pipe(z.string().max(300, "Notes must be at most 300 characters."))
      .optional(),
    idempotencyKey: z.string().uuid("Invalid submission key.").optional(),
  })
  .strict();

export type WalkInTokenInput = z.infer<typeof walkInTokenSchema>;

export const transitionTokenStatusSchema = z
  .object({
    action: z.enum(["START_SERVICE", "COMPLETE", "SKIP", "CANCEL", "MARK_NO_SHOW"]),
    reason: z
      .string()
      .transform(sanitizePlainText)
      .pipe(z.string().max(200, "Reason must be at most 200 characters."))
      .optional(),
  })
  .strict();

export type TransitionTokenStatusInput = z.infer<typeof transitionTokenStatusSchema>;

const dateIsoSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD format.");

export const branchHistoryQuerySchema = z
  .object({
    dateFrom: dateIsoSchema.optional(),
    dateTo: dateIsoSchema.optional(),
    status: z
      .enum([
        "ALL",
        "WAITING",
        "CALLED",
        "IN_SERVICE",
        "COMPLETED",
        "SKIPPED",
        "CANCELLED",
        "NO_SHOW",
      ])
      .optional()
      .default("ALL"),
    search: z.string().transform(sanitizePlainText).pipe(z.string().max(80)).optional(),
    cursor: z.string().trim().max(256).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional().default(25),
  })
  .strict();

export type BranchHistoryQueryInput = z.infer<typeof branchHistoryQuerySchema>;
