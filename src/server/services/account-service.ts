import { UnauthorizedError, ValidationError } from "@/lib/errors";
import {
  hashPassword,
  verifyPassword,
  type AuthorizedTenantContext,
} from "@/server/auth";
import { withTenantDb, type DbClient } from "@/server/db";

export interface ChangePasswordParams {
  ctx: AuthorizedTenantContext;
  currentPassword: string;
  newPassword: string;
  ipAddressHash?: string;
  userAgent?: string;
  client?: DbClient;
}

export async function changeUserPassword(
  params: ChangePasswordParams,
): Promise<{ sessionVersion: number }> {
  const { ctx, currentPassword, newPassword } = params;

  if (currentPassword === newPassword) {
    throw new ValidationError("New password must differ from your current password.");
  }

  return withTenantDb(
    ctx.organizationId,
    async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: ctx.userId },
        select: { id: true, passwordHash: true, isActive: true },
      });

      if (!user || !user.isActive) {
        throw new UnauthorizedError("Session is no longer valid.");
      }

      const validCurrent = await verifyPassword(currentPassword, user.passwordHash);
      if (!validCurrent) {
        throw new ValidationError("Current password is incorrect.", {
          currentPassword: ["Current password is incorrect."],
        });
      }

      const newPasswordHash = await hashPassword(newPassword);
      const updated = await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash: newPasswordHash,
          sessionVersion: { increment: 1 },
        },
        select: { sessionVersion: true },
      });

      await tx.auditLog.create({
        data: {
          organizationId: ctx.organizationId,
          actorType: ctx.roleSlug === "OWNER" ? "OWNER" : "STAFF",
          actorId: ctx.userId,
          action: "PASSWORD_CHANGED",
          entityType: "User",
          entityId: ctx.userId,
          ipAddressHash: params.ipAddressHash ?? null,
          userAgent: params.userAgent?.slice(0, 256) ?? null,
        },
      });

      return { sessionVersion: updated.sessionVersion };
    },
    params.client,
  );
}
