import { NotFoundError, ForbiddenError, ValidationError } from "@/lib/errors";
import { hashPassword, type AuthorizedTenantContext } from "@/server/auth";
import { withSystemDb, withTenantDb, type DbClient } from "@/server/db";
import { generateOpaqueToken, hashVerificationToken } from "@/server/security/tokens";
import type {
  AcceptInviteInput,
  InviteStaffInput,
  UpdateStaffMemberInput,
} from "@/features/staff/schemas";

const INVITE_TTL_MS = 48 * 60 * 60_000;

export interface StaffMutationMeta {
  ipAddressHash?: string;
  userAgent?: string;
  now?: Date;
  client?: DbClient;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  const prefix = local.slice(0, 2);
  return `${prefix}***@${domain}`;
}

export async function listStaffAndRoles(ctx: AuthorizedTenantContext, client?: DbClient) {
  return withTenantDb(
    ctx.organizationId,
    async (tx) => {
      const [members, roles, branches] = await Promise.all([
        tx.organizationMember.findMany({
          where: { organizationId: ctx.organizationId },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            userId: true,
            allBranches: true,
            status: true,
            inviteExpiresAt: true,
            createdAt: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                emailVerifiedAt: true,
                lastLoginAt: true,
              },
            },
            staffRole: {
              select: { id: true, name: true, slug: true },
            },
            branchAccess: {
              select: {
                branchId: true,
                branch: { select: { id: true, name: true } },
              },
            },
          },
        }),
        tx.staffRole.findMany({
          where: { organizationId: ctx.organizationId },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            name: true,
            slug: true,
            isSystemDefault: true,
            permissions: { select: { permissionKey: true } },
          },
        }),
        tx.branch.findMany({
          where: { organizationId: ctx.organizationId },
          orderBy: { createdAt: "asc" },
          select: { id: true, name: true, city: true, isActive: true },
        }),
      ]);

      return {
        members: members.map((m) => ({
          id: m.id,
          userId: m.userId,
          name: m.user.name,
          email: m.user.email,
          emailVerified: Boolean(m.user.emailVerifiedAt),
          lastLoginAt: m.user.lastLoginAt,
          status: m.status,
          allBranches: m.allBranches,
          inviteExpiresAt: m.inviteExpiresAt,
          role: m.staffRole,
          branches: m.branchAccess.map((b) => b.branch),
        })),
        roles: roles.map((r) => ({
          id: r.id,
          name: r.name,
          slug: r.slug,
          isSystemDefault: r.isSystemDefault,
          permissions: r.permissions.map((p) => p.permissionKey),
        })),
        branches,
      };
    },
    client,
  );
}

export async function createStaffInvite(
  ctx: AuthorizedTenantContext,
  input: InviteStaffInput,
  meta: StaffMutationMeta = {},
) {
  const now = meta.now ?? new Date();
  const normalizedEmail = input.email.trim().toLowerCase();
  const uniqueBranchIds = input.allBranches ? [] : [...new Set(input.branchIds)];

  const rawInviteToken = generateOpaqueToken(24);
  const inviteTokenHash = hashVerificationToken(rawInviteToken);
  const inviteExpiresAt = new Date(now.getTime() + INVITE_TTL_MS);

  // Placeholder unguessable hash only used when creating an unregistered invited user
  const placeholderPasswordHash = await hashPassword(generateOpaqueToken(24), 10);

  return withTenantDb(
    ctx.organizationId,
    async (tx) => {
      const role = await tx.staffRole.findFirst({
        where: { id: input.roleId, organizationId: ctx.organizationId },
        select: { id: true, slug: true, name: true },
      });

      if (!role) {
        throw new NotFoundError("Selected staff role was not found.");
      }

      if (uniqueBranchIds.length > 0) {
        const validBranches = await tx.branch.findMany({
          where: {
            organizationId: ctx.organizationId,
            id: { in: uniqueBranchIds },
          },
          select: { id: true },
        });
        if (validBranches.length !== uniqueBranchIds.length) {
          throw new NotFoundError("One or more selected branches were not found.");
        }
      }

      let user = await tx.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true, email: true, name: true },
      });

      if (!user) {
        user = await tx.user.create({
          data: {
            name: input.name.trim(),
            email: normalizedEmail,
            passwordHash: placeholderPasswordHash,
            emailVerifiedAt: null,
            isPlatformAdmin: false,
            isActive: true,
          },
          select: { id: true, email: true, name: true },
        });
      }

      const existingMembership = await tx.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: ctx.organizationId,
            userId: user.id,
          },
        },
        select: { id: true, status: true },
      });

      if (
        existingMembership &&
        (existingMembership.status === "ACTIVE" ||
          existingMembership.status === "SUSPENDED")
      ) {
        throw new ValidationError("This user is already a member of your organization.", {
          email: ["User already has an active or suspended membership."],
        });
      }

      const member = existingMembership
        ? await tx.organizationMember.update({
            where: { id: existingMembership.id },
            data: {
              staffRoleId: role.id,
              allBranches: input.allBranches,
              status: "INVITED",
              inviteTokenHash,
              inviteExpiresAt,
            },
            select: { id: true },
          })
        : await tx.organizationMember.create({
            data: {
              organizationId: ctx.organizationId,
              userId: user.id,
              staffRoleId: role.id,
              allBranches: input.allBranches,
              status: "INVITED",
              inviteTokenHash,
              inviteExpiresAt,
            },
            select: { id: true },
          });

      await tx.staffBranchAccess.deleteMany({
        where: { organizationId: ctx.organizationId, memberId: member.id },
      });

      if (!input.allBranches && uniqueBranchIds.length > 0) {
        await tx.staffBranchAccess.createMany({
          data: uniqueBranchIds.map((branchId) => ({
            organizationId: ctx.organizationId,
            memberId: member.id,
            branchId,
          })),
        });
      }

      await tx.auditLog.create({
        data: {
          organizationId: ctx.organizationId,
          actorType: ctx.roleSlug === "OWNER" ? "OWNER" : "STAFF",
          actorId: ctx.userId,
          action: "STAFF_INVITED",
          entityType: "OrganizationMember",
          entityId: member.id,
          ipAddressHash: meta.ipAddressHash ?? null,
          userAgent: meta.userAgent?.slice(0, 256) ?? null,
          metadata: {
            invitedUserId: user.id,
            roleSlug: role.slug,
            allBranches: input.allBranches,
            branchCount: uniqueBranchIds.length,
          },
        },
      });

      return {
        memberId: member.id,
        email: user.email,
        roleName: role.name,
        status: "INVITED" as const,
        expiresAt: inviteExpiresAt.toISOString(),
        invitePath: `/invite/${rawInviteToken}`,
      };
    },
    meta.client,
  );
}

export async function getInvitePreview(
  rawToken: string,
  now: Date = new Date(),
  client?: DbClient,
) {
  const tokenHash = hashVerificationToken(rawToken);

  return withSystemDb(async (tx) => {
    const member = await tx.organizationMember.findFirst({
      where: { inviteTokenHash: tokenHash, status: "INVITED" },
      select: {
        id: true,
        inviteExpiresAt: true,
        organization: { select: { name: true, status: true } },
        staffRole: { select: { name: true } },
        user: { select: { name: true, email: true } },
      },
    });

    if (!member || !member.inviteExpiresAt || member.inviteExpiresAt < now) {
      throw new NotFoundError("Invitation link is invalid or has expired.");
    }

    if (member.organization.status !== "ACTIVE") {
      throw new ForbiddenError(
        "TENANT_SUSPENDED",
        "This organization is not accepting invited members right now.",
      );
    }

    return {
      organizationName: member.organization.name,
      roleName: member.staffRole.name,
      memberName: member.user.name,
      maskedEmail: maskEmail(member.user.email),
      expiresAt: member.inviteExpiresAt.toISOString(),
    };
  }, client);
}

export async function acceptStaffInvite(
  rawToken: string,
  input: AcceptInviteInput,
  meta: StaffMutationMeta = {},
) {
  const now = meta.now ?? new Date();
  const tokenHash = hashVerificationToken(rawToken);
  const newPasswordHash = await hashPassword(input.password);

  return withSystemDb(async (tx) => {
    const member = await tx.organizationMember.findFirst({
      where: { inviteTokenHash: tokenHash, status: "INVITED" },
      select: {
        id: true,
        organizationId: true,
        userId: true,
        inviteExpiresAt: true,
        organization: { select: { name: true, status: true } },
        user: { select: { id: true, name: true, email: true, emailVerifiedAt: true } },
      },
    });

    if (!member || !member.inviteExpiresAt || member.inviteExpiresAt < now) {
      throw new NotFoundError("Invitation link is invalid or has expired.");
    }

    if (member.organization.status !== "ACTIVE") {
      throw new ForbiddenError(
        "TENANT_SUSPENDED",
        "This organization is currently suspended or inactive.",
      );
    }

    await tx.user.update({
      where: { id: member.userId },
      data: {
        name: input.name?.trim() || member.user.name,
        passwordHash: newPasswordHash,
        emailVerifiedAt: member.user.emailVerifiedAt ?? now,
        isActive: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });

    await tx.organizationMember.update({
      where: { id: member.id },
      data: {
        status: "ACTIVE",
        inviteTokenHash: null,
        inviteExpiresAt: null,
      },
    });

    await tx.auditLog.create({
      data: {
        organizationId: member.organizationId,
        actorType: "STAFF",
        actorId: member.userId,
        action: "STAFF_INVITE_ACCEPTED",
        entityType: "OrganizationMember",
        entityId: member.id,
        ipAddressHash: meta.ipAddressHash ?? null,
        userAgent: meta.userAgent?.slice(0, 256) ?? null,
      },
    });

    return {
      accepted: true,
      email: member.user.email,
      organizationName: member.organization.name,
    };
  }, meta.client);
}

export async function updateStaffMember(
  ctx: AuthorizedTenantContext,
  memberId: string,
  input: UpdateStaffMemberInput,
  meta: StaffMutationMeta = {},
) {
  const now = meta.now ?? new Date();

  return withTenantDb(
    ctx.organizationId,
    async (tx) => {
      const member = await tx.organizationMember.findFirst({
        where: { id: memberId, organizationId: ctx.organizationId },
        select: { id: true, userId: true, status: true, allBranches: true },
      });

      if (!member) {
        throw new NotFoundError("Staff member was not found.");
      }

      if (member.userId === ctx.userId) {
        throw new ValidationError("You cannot modify your own role or access status.");
      }

      if (member.status === "REVOKED") {
        throw new ValidationError(
          "Revoked members cannot be edited. Send a fresh staff invitation instead.",
        );
      }

      if (input.roleId !== undefined) {
        const role = await tx.staffRole.findFirst({
          where: { id: input.roleId, organizationId: ctx.organizationId },
          select: { id: true },
        });
        if (!role) {
          throw new NotFoundError("Selected staff role was not found.");
        }
      }

      const nextAllBranches = input.allBranches ?? member.allBranches;

      if (!nextAllBranches && input.branchIds !== undefined) {
        const uniqueBranchIds = [...new Set(input.branchIds)];
        if (uniqueBranchIds.length === 0) {
          throw new ValidationError("Select at least one branch.");
        }

        const validBranches = await tx.branch.findMany({
          where: { organizationId: ctx.organizationId, id: { in: uniqueBranchIds } },
          select: { id: true },
        });
        if (validBranches.length !== uniqueBranchIds.length) {
          throw new NotFoundError("One or more selected branches were not found.");
        }

        await tx.staffBranchAccess.deleteMany({
          where: { organizationId: ctx.organizationId, memberId: member.id },
        });

        await tx.staffBranchAccess.createMany({
          data: uniqueBranchIds.map((branchId) => ({
            organizationId: ctx.organizationId,
            memberId: member.id,
            branchId,
          })),
        });
      } else if (input.allBranches === true) {
        await tx.staffBranchAccess.deleteMany({
          where: { organizationId: ctx.organizationId, memberId: member.id },
        });
      }

      await tx.organizationMember.update({
        where: { id: member.id },
        data: {
          ...(input.roleId !== undefined ? { staffRoleId: input.roleId } : {}),
          ...(input.allBranches !== undefined ? { allBranches: input.allBranches } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
      });

      if (input.status === "SUSPENDED") {
        await tx.user.update({
          where: { id: member.userId },
          data: { sessionVersion: { increment: 1 } },
        });

        await tx.pushSubscription.updateMany({
          where: {
            organizationId: ctx.organizationId,
            userId: member.userId,
            isActive: true,
          },
          data: {
            isActive: false,
            revokedAt: now,
            revokedReason: "MEMBER_SUSPENDED",
          },
        });
      }

      await tx.auditLog.create({
        data: {
          organizationId: ctx.organizationId,
          actorType: ctx.roleSlug === "OWNER" ? "OWNER" : "STAFF",
          actorId: ctx.userId,
          action: "STAFF_MEMBER_UPDATED",
          entityType: "OrganizationMember",
          entityId: member.id,
          ipAddressHash: meta.ipAddressHash ?? null,
          userAgent: meta.userAgent?.slice(0, 256) ?? null,
          metadata: { updatedFields: Object.keys(input) },
        },
      });

      return { updated: true, memberId: member.id };
    },
    meta.client,
  );
}

export async function revokeStaffMember(
  ctx: AuthorizedTenantContext,
  memberId: string,
  meta: StaffMutationMeta = {},
) {
  const now = meta.now ?? new Date();

  return withTenantDb(
    ctx.organizationId,
    async (tx) => {
      const member = await tx.organizationMember.findFirst({
        where: { id: memberId, organizationId: ctx.organizationId },
        select: { id: true, userId: true, status: true },
      });

      if (!member) {
        throw new NotFoundError("Staff member was not found.");
      }

      if (member.userId === ctx.userId) {
        throw new ValidationError("You cannot revoke your own access.");
      }

      await tx.organizationMember.update({
        where: { id: member.id },
        data: {
          status: "REVOKED",
          inviteTokenHash: null,
          inviteExpiresAt: null,
        },
      });

      await tx.user.update({
        where: { id: member.userId },
        data: { sessionVersion: { increment: 1 } },
      });

      await tx.pushSubscription.updateMany({
        where: {
          organizationId: ctx.organizationId,
          userId: member.userId,
          isActive: true,
        },
        data: {
          isActive: false,
          revokedAt: now,
          revokedReason: "MEMBER_REVOKED",
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: ctx.organizationId,
          actorType: ctx.roleSlug === "OWNER" ? "OWNER" : "STAFF",
          actorId: ctx.userId,
          action: "STAFF_REVOKED",
          entityType: "OrganizationMember",
          entityId: member.id,
          ipAddressHash: meta.ipAddressHash ?? null,
          userAgent: meta.userAgent?.slice(0, 256) ?? null,
          metadata: { revokedUserId: member.userId },
        },
      });

      return { revoked: true, memberId: member.id };
    },
    meta.client,
  );
}
