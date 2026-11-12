import { z } from "zod";

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "Slug must be at least 2 characters.")
  .max(60, "Slug must be at most 60 characters.")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use lowercase letters, numbers, and single hyphens only.",
  );

export function toUrlSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export const registerSalonSchema = z
  .object({
    ownerName: z
      .string()
      .trim()
      .min(2, "Full name must be at least 2 characters.")
      .max(100, "Full name is too long."),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email("Please enter a valid work email address.")
      .max(160),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters.")
      .max(128, "Password must be at most 128 characters."),
    organizationName: z
      .string()
      .trim()
      .min(2, "Salon name must be at least 2 characters.")
      .max(120),
    salonSlug: slugSchema,
    branchName: z.string().trim().min(2).max(120).default("Main Branch"),
    branchSlug: slugSchema.default("main"),
    city: z.string().trim().max(80).optional(),
    address: z.string().trim().max(300).optional(),
    phone: z
      .string()
      .trim()
      .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number.")
      .optional()
      .or(z.literal("")),
    timezone: z.string().trim().min(2).max(64).default("Asia/Kolkata"),
    website: z.string().max(120).optional().default(""),
  })
  .strict();

export type RegisterSalonInput = z.infer<typeof registerSalonSchema>;

export const verifyEmailSchema = z
  .object({
    token: z.string().trim().min(16, "Invalid verification token.").max(256),
  })
  .strict();
