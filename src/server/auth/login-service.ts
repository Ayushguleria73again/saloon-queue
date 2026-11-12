import type { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";
import { withSystemDb } from "@/server/db";
import { verifyPassword } from "./password";
import type { SessionUserClaims } from "./types";

export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 15 * 60_000;

export type AuthenticateFailureReason =
  | "INVALID_CREDENTIALS"
  | "ACCOUNT_LOCKED"
  | "EMAIL_NOT_VERIFIED"
  | "INACTIVE_USER"
  | "NO_ACTIVE_MEMBERSHIP";

export type AuthenticateResult =
  | { ok: true; user: SessionUserClaims }
  | { ok: false; reason: AuthenticateFailureReason };

export interface AuthenticateParams {
  email: string;
  password: string;
  ipAddressHash?: string;
  userAgent?: string;
  now?: Date;
  client?: PrismaClient;
}

export async function authenticateWithCredentials(
  params: AuthenticateParams,
): Promise<AuthenticateResult> {
  const normalizedEmail = params.email.trim().toLowerCase();
  const now = params.now ?? new Date();

  return withSystemDb(async (tx) => {
    const user = await tx.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        email: true,
        name: true,
        passwordHash: true,
        emailVerifiedAt: true,
        isPlatformAdmin: true,
        isActive: true,
        sessionVersion: true,
        failedLoginAttempts: true,
        lockedUntil: true,
        memberships: {
          where: { status: "ACTIVE" },
          orderBy: { createdAt: "asc" },
          select: {
            organizationId: true,
            organization: {
              select: { status: true },
            },
          },
        },
      },
    });

    if (!user) {
      return { ok: false, reason: "INVALID_CREDENTIALS" };
    }

    if (!user.isActive) {
      return { ok: false, reason: "INACTIVE_USER" };
    }

    if (user.lockedUntil && user.lockedUntil > now) {
      return { ok: false, reason: "ACCOUNT_LOCKED" };
    }

    const passwordValid = await verifyPassword(params.password, user.passwordHash);

    if (!passwordValid) {
      const baseAttempts =
        user.lockedUntil && user.lockedUntil <= now ? 0 : user.failedLoginAttempts;
      const nextAttempts = baseAttempts + 1;
      const shouldLock = nextAttempts >= MAX_FAILED_LOGIN_ATTEMPTS;
      const nextLockedUntil = shouldLock
        ? new Date(now.getTime() + LOCKOUT_DURATION_MS)
        : null;

      await tx.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: nextAttempts,
          lockedUntil: nextLockedUntil,
        },
      });

      if (shouldLock) {
        const primaryOrgId = user.memberships[0]?.organizationId ?? null;
        await tx.auditLog.create({
          data: {
            organizationId: primaryOrgId,
            actorType: user.isPlatformAdmin ? "PLATFORM_ADMIN" : "OWNER",
            actorId: user.id,
            action: "LOGIN_LOCKED",
            entityType: "User",
            entityId: user.id,
            ipAddressHash: params.ipAddressHash ?? null,
            userAgent: params.userAgent?.slice(0, 256) ?? null,
            metadata: {
              failedAttempts: nextAttempts,
              lockedUntil: nextLockedUntil?.toISOString() ?? null,
            },
          },
        });

        logger.warn(
          { module: "auth", userId: user.id, failedAttempts: nextAttempts },
          "Account locked after repeated failed login attempts",
        );

        return { ok: false, reason: "ACCOUNT_LOCKED" };
      }

      return { ok: false, reason: "INVALID_CREDENTIALS" };
    }

    if (!user.emailVerifiedAt) {
      await tx.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
      return { ok: false, reason: "EMAIL_NOT_VERIFIED" };
    }

    const activeOrgMembership =
      user.memberships.find((m) => m.organization.status === "ACTIVE") ??
      user.memberships[0];

    const activeOrganizationId = activeOrgMembership?.organizationId ?? null;

    if (!user.isPlatformAdmin && !activeOrganizationId) {
      return { ok: false, reason: "NO_ACTIVE_MEMBERSHIP" };
    }

    await tx.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: now,
      },
    });

    return {
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        activeOrganizationId,
        sessionVersion: user.sessionVersion,
        isPlatformAdmin: user.isPlatformAdmin,
      },
    };
  }, params.client);
}
