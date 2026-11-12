import { z } from "zod";

export const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email("Please enter a valid email address."),
    password: z
      .string()
      .min(1, "Password is required.")
      .max(128, "Password is too long."),
  })
  .strict();

export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, "Current password is required.")
      .max(128, "Password is too long."),
    newPassword: z
      .string()
      .min(8, "New password must be at least 8 characters.")
      .max(128, "New password must be at most 128 characters."),
  })
  .strict();

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export function sanitizeCallbackUrl(
  rawUrl: string | null | undefined,
  fallback = "/owner/dashboard",
): string {
  if (!rawUrl) {
    return fallback;
  }

  const trimmed = rawUrl.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("/\\")) {
    return fallback;
  }

  return trimmed;
}
