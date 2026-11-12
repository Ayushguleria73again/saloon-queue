import { z } from "zod";
import { slugSchema } from "@/features/onboarding/schemas";

const timeHhMmSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Use 24-hour HH:MM format.");

export const businessHourEntrySchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    isOpen: z.boolean(),
    openTime: timeHhMmSchema,
    closeTime: timeHhMmSchema,
    breakStartTime: timeHhMmSchema.nullable().optional(),
    breakEndTime: timeHhMmSchema.nullable().optional(),
  })
  .strict();

export type BusinessHourEntryInput = z.infer<typeof businessHourEntrySchema>;

export const branchSettingsUpdateSchema = z
  .object({
    tokenPrefix: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{1,4}$/, "Prefix must be 1–4 uppercase characters.")
      .optional(),
    activeStationsCount: z.number().int().min(1).max(50).optional(),
    allowDuplicateActiveTokens: z.boolean().optional(),
    allowCustomerCancel: z.boolean().optional(),
    enforceBusinessHours: z.boolean().optional(),
    isAcceptingTokens: z.boolean().optional(),
    queuePausedReason: z.string().trim().max(200).nullable().optional(),
    requireValidQrToken: z.boolean().optional(),
    estimatedBufferMinutes: z.number().int().min(0).max(180).optional(),
  })
  .strict();

export type BranchSettingsUpdateInput = z.infer<typeof branchSettingsUpdateSchema>;

export const createBranchSchema = z
  .object({
    name: z.string().trim().min(2, "Branch name must be at least 2 characters.").max(120),
    slug: slugSchema,
    phone: z
      .string()
      .trim()
      .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number.")
      .optional()
      .or(z.literal("")),
    address: z.string().trim().max(300).optional(),
    city: z.string().trim().max(80).optional(),
    timezone: z.string().trim().min(2).max(64).default("Asia/Kolkata"),
  })
  .strict();

export type CreateBranchInput = z.infer<typeof createBranchSchema>;

export const updateBranchSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    phone: z
      .string()
      .trim()
      .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number.")
      .nullable()
      .optional()
      .or(z.literal("")),
    address: z.string().trim().max(300).nullable().optional(),
    city: z.string().trim().max(80).nullable().optional(),
    timezone: z.string().trim().min(2).max(64).optional(),
    isActive: z.boolean().optional(),
    businessHours: z.array(businessHourEntrySchema).max(7).optional(),
    settings: branchSettingsUpdateSchema.optional(),
  })
  .strict();

export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;
