import { z } from "zod";

export const adminTenantQuerySchema = z.object({
  status: z
    .enum(["ALL", "PENDING", "ACTIVE", "SUSPENDED", "DEACTIVATED"])
    .default("ALL"),
  q: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type AdminTenantQueryInput = z.infer<typeof adminTenantQuerySchema>;

export const updateTenantStatusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "DEACTIVATED"]),
  reason: z
    .string()
    .trim()
    .min(3, "Reason must be at least 3 characters.")
    .max(300, "Reason cannot exceed 300 characters."),
});

export type UpdateTenantStatusInput = z.infer<typeof updateTenantStatusSchema>;

export const adminJobQuerySchema = z.object({
  status: z
    .enum(["ALL", "PENDING", "PROCESSING", "PROCESSED", "RETRYING", "DEAD_LETTER"])
    .default("ALL"),
  q: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type AdminJobQueryInput = z.infer<typeof adminJobQuerySchema>;

