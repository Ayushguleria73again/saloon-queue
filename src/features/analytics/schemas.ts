import { z } from "zod";

export const analyticsQuerySchema = z
  .object({
    range: z.enum(["today", "7d", "30d", "90d", "custom"]).default("7d"),
    branchId: z
      .string()
      .trim()
      .optional()
      .transform((val) => (val === "all" || !val ? undefined : val))
      .pipe(z.string().uuid().optional()),
    from: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "From date must be formatted YYYY-MM-DD")
      .optional(),
    to: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "To date must be formatted YYYY-MM-DD")
      .optional(),
    granularity: z.enum(["day", "week", "month"]).optional(),
  })
  .refine(
    (data) => {
      if (data.range === "custom") {
        return Boolean(data.from && data.to);
      }
      return true;
    },
    {
      message: "Custom date range requires both 'from' and 'to' dates (YYYY-MM-DD).",
      path: ["from"],
    },
  )
  .refine(
    (data) => {
      if (data.from && data.to) {
        return data.from <= data.to;
      }
      return true;
    },
    {
      message: "'from' date cannot be after 'to' date.",
      path: ["from"],
    },
  );

export type AnalyticsQueryInput = z.infer<typeof analyticsQuerySchema>;

