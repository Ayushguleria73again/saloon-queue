import type { AuthorizedTenantContext } from "@/server/auth";
import { withTenantDb, type DbClient } from "@/server/db";
import type { BranchSettingsUpdateInput } from "@/features/branches/schemas";

export async function getOrganizationSettings(
  ctx: AuthorizedTenantContext,
  client?: DbClient,
) {
  return withTenantDb(
    ctx.organizationId,
    async (tx) => {
      return tx.salonSettings.findFirst({
        where: { organizationId: ctx.organizationId, branchId: null },
      });
    },
    client,
  );
}

export async function updateOrganizationSettings(
  ctx: AuthorizedTenantContext,
  input: BranchSettingsUpdateInput,
  meta: { ipAddressHash?: string; userAgent?: string; client?: DbClient } = {},
) {
  return withTenantDb(
    ctx.organizationId,
    async (tx) => {
      const existing = await tx.salonSettings.findFirst({
        where: { organizationId: ctx.organizationId, branchId: null },
        select: { id: true },
      });

      const updated = existing
        ? await tx.salonSettings.update({
            where: { id: existing.id },
            data: input,
          })
        : await tx.salonSettings.create({
            data: {
              organizationId: ctx.organizationId,
              branchId: null,
              ...input,
            },
          });

      await tx.auditLog.create({
        data: {
          organizationId: ctx.organizationId,
          actorType: ctx.roleSlug === "OWNER" ? "OWNER" : "STAFF",
          actorId: ctx.userId,
          action: "ORG_SETTINGS_UPDATED",
          entityType: "SalonSettings",
          entityId: updated.id,
          ipAddressHash: meta.ipAddressHash ?? null,
          userAgent: meta.userAgent?.slice(0, 256) ?? null,
          metadata: { updatedFields: Object.keys(input) },
        },
      });

      return updated;
    },
    meta.client,
  );
}
