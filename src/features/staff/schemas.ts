import { z } from "zod";

export const inviteStaffSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Staff name must be at least 2 characters.")
      .max(100),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email("Enter a valid email address.")
      .max(160),
    roleId: z.string().uuid("Select a valid staff role."),
    allBranches: z.boolean().default(false),
    branchIds: z.array(z.string().uuid()).max(50).default([]),
  })
  .strict()
  .refine((data) => data.allBranches || data.branchIds.length > 0, {
    message: "Select All Branches or assign at least one branch.",
    path: ["branchIds"],
  });

export type InviteStaffInput = z.infer<typeof inviteStaffSchema>;

export const updateStaffMemberSchema = z
  .object({
    roleId: z.string().uuid().optional(),
    allBranches: z.boolean().optional(),
    branchIds: z.array(z.string().uuid()).max(50).optional(),
    status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  })
  .strict()
  .refine(
    (data) => data.allBranches !== false || !data.branchIds || data.branchIds.length > 0,
    {
      message: "Assign at least one branch when All Branches is unchecked.",
      path: ["branchIds"],
    },
  );

export type UpdateStaffMemberInput = z.infer<typeof updateStaffMemberSchema>;

export const acceptInviteSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters.")
      .max(128, "Password is too long."),
  })
  .strict();

export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
