import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@/lib/errors";
import { withSystemDb, withTenantDb } from "@/server/db";
import {
  PERMISSION_KEY_SET,
  type AuthorizedTenantContext,
  type PermissionKey,
  type PlatformAdminContext,
  type SessionUserClaims,
} from "./types";

const uuidSchema = z.string().uuid();

export interface AuthorizeTenantActionOptions {
  requiredPermission?: PermissionKey;
  branchId?: string;
  session?: SessionUserClaims | null;
  client?: PrismaClient;
}

export interface RequirePlatformAdminOptions {
  session?: SessionUserClaims | null;
  client?: PrismaClient;
}

async function resolveSessionClaims(
  providedSession?: SessionUserClaims | null,
): Promise<SessionUserClaims> {
  if (providedSession !== undefined) {
    if (!providedSession?.id) {
      throw new UnauthorizedError("Authentication required.");
    }
    return providedSession;
  }

  const { auth } = await import("./auth");
  const session = await auth();
  if (!session?.user?.id) {
    throw new UnauthorizedError("Authentication required.");
  }

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    activeOrganizationId: session.user.activeOrganizationId ?? null,
    sessionVersion: session.user.sessionVersion,
    isPlatformAdmin: Boolean(session.user.isPlatformAdmin),
  };
}

export async function authorizeTenantAction(
  options: AuthorizeTenantActionOptions = {},
): Promise<AuthorizedTenantContext> {
  if (options.branchId !== undefined) {
    const branchIdParsed = uuidSchema.safeParse(options.branchId);
    if (!branchIdParsed.success) {
      throw new ValidationError("Invalid branch identifier.");
    }
  }

  const session = await resolveSessionClaims(options.session);
  const organizationId = session.activeOrganizationId;
  if (!organizationId || !uuidSchema.safeParse(organizationId).success) {
    throw new ForbiddenError("FORBIDDEN", "No active organization membership selected.");
  }

  // 1. Validate User sessionVersion, Organization status, and OrganizationMember status
  const membershipCheck = await withSystemDb(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: session.id },
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true,
        isPlatformAdmin: true,
        sessionVersion: true,
      },
    });

    if (!user || !user.isActive || user.sessionVersion !== session.sessionVersion) {
      throw new UnauthorizedError("Session is no longer valid. Please sign in again.");
    }

    const organization = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, status: true },
    });

    if (!organization) {
      throw new UnauthorizedError("Organization context is no longer valid.");
    }

    if (organization.status !== "ACTIVE") {
      throw new ForbiddenError(
        "TENANT_SUSPENDED",
        "Your salon organization account is currently suspended or inactive.",
      );
    }

    return { user, organizationName: organization.name };
  }, options.client);

  // 2. Load member RBAC permissions & branch access strictly inside tenant RLS scope
  return withTenantDb(
    organizationId,
    async (tx) => {
      const member = await tx.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId,
            userId: membershipCheck.user.id,
          },
        },
        select: {
          id: true,
          status: true,
          allBranches: true,
          staffRole: {
            select: {
              slug: true,
              permissions: {
                select: { permissionKey: true },
              },
            },
          },
          branchAccess: {
            select: { branchId: true },
          },
        },
      });

      if (!member || member.status !== "ACTIVE") {
        throw new UnauthorizedError(
          "Organization membership has been revoked or suspended.",
        );
      }

      const permissions = new Set<PermissionKey>();
      for (const perm of member.staffRole.permissions) {
        if (PERMISSION_KEY_SET.has(perm.permissionKey)) {
          permissions.add(perm.permissionKey as PermissionKey);
        }
      }

      if (options.requiredPermission && !permissions.has(options.requiredPermission)) {
        throw new ForbiddenError(
          "FORBIDDEN",
          "You do not have permission to perform this action.",
        );
      }

      const allowedBranchIds = new Set(member.branchAccess.map((b) => b.branchId));

      if (options.branchId !== undefined) {
        // Under RLS + organizationId filter, cross-tenant branchId returns null -> 404 (blocks enumeration)
        const branch = await tx.branch.findFirst({
          where: {
            id: options.branchId,
            organizationId,
          },
          select: { id: true },
        });

        if (!branch) {
          throw new NotFoundError("Branch was not found.");
        }

        if (!member.allBranches && !allowedBranchIds.has(options.branchId)) {
          throw new ForbiddenError(
            "BRANCH_ACCESS_DENIED",
            "You do not have access to this branch.",
          );
        }
      }

      return {
        userId: membershipCheck.user.id,
        email: membershipCheck.user.email,
        name: membershipCheck.user.name,
        isPlatformAdmin: membershipCheck.user.isPlatformAdmin,
        organizationId,
        organizationName: membershipCheck.organizationName,
        memberId: member.id,
        roleSlug: member.staffRole.slug,
        allBranches: member.allBranches,
        permissions,
        allowedBranchIds,
        ...(options.branchId !== undefined ? { branchId: options.branchId } : {}),
      };
    },
    options.client,
  );
}

export async function requirePlatformAdmin(
  options: RequirePlatformAdminOptions = {},
): Promise<PlatformAdminContext> {
  const session = await resolveSessionClaims(options.session);

  return withSystemDb(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: session.id },
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true,
        isPlatformAdmin: true,
        sessionVersion: true,
      },
    });

    if (!user || !user.isActive || user.sessionVersion !== session.sessionVersion) {
      throw new UnauthorizedError("Session is no longer valid. Please sign in again.");
    }

    if (!user.isPlatformAdmin) {
      throw new ForbiddenError("FORBIDDEN", "Platform Administrator access required.");
    }

    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      isPlatformAdmin: true,
    };
  }, options.client);
}
