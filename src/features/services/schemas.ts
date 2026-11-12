import { z } from "zod";

export const createServiceSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Service name must be at least 2 characters.")
      .max(100, "Service name is too long."),
    description: z.string().trim().max(300).nullable().optional(),
    basePriceInPaise: z
      .number()
      .int("Price must be stored in integer paise.")
      .min(0, "Price cannot be negative.")
      .max(10_000_000, "Price exceeds maximum limit."),
    baseDurationMinutes: z
      .number()
      .int("Duration must be a whole number of minutes.")
      .min(1, "Duration must be at least 1 minute.")
      .max(600, "Duration must be at most 600 minutes."),
    sortOrder: z.number().int().min(0).max(10000).default(0),
  })
  .strict();

export type CreateServiceInput = z.infer<typeof createServiceSchema>;

export const updateServiceSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    description: z.string().trim().max(300).nullable().optional(),
    basePriceInPaise: z.number().int().min(0).max(10_000_000).optional(),
    baseDurationMinutes: z.number().int().min(1).max(600).optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(10000).optional(),
  })
  .strict();

export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;

export const upsertBranchServiceSchema = z
  .object({
    isAvailable: z.boolean(),
    priceOverrideInPaise: z.number().int().min(0).max(10_000_000).nullable().optional(),
    durationOverrideMinutes: z.number().int().min(1).max(600).nullable().optional(),
    sortOrder: z.number().int().min(0).max(10000).optional(),
  })
  .strict();

export type UpsertBranchServiceInput = z.infer<typeof upsertBranchServiceSchema>;
