import { Prisma } from "@prisma/client";
import { ConflictError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { hashPassword } from "@/server/auth";
import { DEFAULT_ROLE_DEFINITIONS } from "@/server/auth/default-roles";
import { withSystemDb, type DbClient } from "@/server/db";
import { generateOpaqueToken, hashVerificationToken } from "@/server/security/tokens";
import type { RegisterSalonInput } from "@/features/onboarding/schemas";

const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60_000;

export interface RegisterSalonResult {
  organizationId: string;
  salonSlug: string;
  branchId: string;
  branchSlug: string;
  userId: string;
  status: "ACTIVE" | "PENDING";
  requiresEmailVerification: true;
  devVerificationPath?: string;
}

export interface RegisterSalonParams {
  input: RegisterSalonInput;
  ipAddressHash?: string;
  userAgent?: string;
  requireAdminApproval?: boolean;
  now?: Date;
  client?: DbClient;
  onVerificationTokenCreated?: (payload: {
    email: string;
    token: string;
  }) => Promise<void> | void;
}

export async function registerSalonOrganization(
  params: RegisterSalonParams,
): Promise<RegisterSalonResult> {
  const { input } = params;
  const now = params.now ?? new Date();

  if (input.website && input.website.trim().length > 0) {
    throw new ValidationError("Unable to process registration request.");
  }

  const normalizedEmail = input.email.trim().toLowerCase();
  const normalizedSalonSlug = input.salonSlug.trim().toLowerCase();
  const normalizedBranchSlug = input.branchSlug.trim().toLowerCase();

  const passwordHash = await hashPassword(input.password);
  const rawVerificationToken = generateOpaqueToken(24);
  const verificationTokenHash = hashVerificationToken(rawVerificationToken);
  const verificationExpiresAt = new Date(now.getTime() + EMAIL_VERIFY_TTL_MS);

  const requireApproval =
    params.requireAdminApproval ??
    (process.env.REQUIRE_ADMIN_TENANT_APPROVAL === "true" ||
      process.env.REQUIRE_ADMIN_TENANT_APPROVAL === "1");
  const initialOrgStatus = requireApproval ? "PENDING" : "ACTIVE";

  let result: RegisterSalonResult;

  try {
    result = await withSystemDb(async (tx) => {
      const existingUser = await tx.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true },
      });

      if (existingUser) {
        throw new ValidationError("An account with this email already exists.", {
          email: ["This email address is already registered."],
        });
      }

      const existingOrg = await tx.organization.findUnique({
        where: { slug: normalizedSalonSlug },
        select: { id: true },
      });

      if (existingOrg) {
        throw new ConflictError(
          "SLUG_TAKEN",
          "This salon URL slug is already in use. Please choose another.",
        );
      }

      const user = await tx.user.create({
        data: {
          name: input.ownerName.trim(),
          email: normalizedEmail,
          passwordHash,
          emailVerifiedAt: null,
          emailVerificationTokenHash: verificationTokenHash,
          emailVerificationExpiresAt: verificationExpiresAt,
          isPlatformAdmin: false,
          isActive: true,
        },
        select: { id: true },
      });

      const organization = await tx.organization.create({
        data: {
          name: input.organizationName.trim(),
          slug: normalizedSalonSlug,
          status: initialOrgStatus,
        },
        select: { id: true, slug: true, status: true },
      });

      let ownerRoleId: string | null = null;
      for (const roleDef of DEFAULT_ROLE_DEFINITIONS) {
        const createdRole = await tx.staffRole.create({
          data: {
            organizationId: organization.id,
            name: roleDef.name,
            slug: roleDef.slug,
            isSystemDefault: true,
            permissions: {
              create: roleDef.permissions.map((permissionKey) => ({
                permissionKey,
              })),
            },
          },
          select: { id: true, slug: true },
        });

        if (createdRole.slug === "OWNER") {
          ownerRoleId = createdRole.id;
        }
      }

      if (!ownerRoleId) {
        throw new Error("Failed to initialize default OWNER role");
      }

      await tx.organizationMember.create({
        data: {
          organizationId: organization.id,
          userId: user.id,
          staffRoleId: ownerRoleId,
          allBranches: true,
          status: "ACTIVE",
        },
      });

      await tx.salonSettings.create({
        data: {
          organizationId: organization.id,
          branchId: null,
        },
      });

      const branch = await tx.branch.create({
        data: {
          organizationId: organization.id,
          name: input.branchName.trim(),
          slug: normalizedBranchSlug,
          phone: input.phone ? input.phone.trim() : null,
          address: input.address ? input.address.trim() : null,
          city: input.city ? input.city.trim() : null,
          timezone: input.timezone,
          qrToken: generateOpaqueToken(16),
          isActive: true,
        },
        select: { id: true, slug: true },
      });

      await tx.businessHours.createMany({
        data: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
          organizationId: organization.id,
          branchId: branch.id,
          dayOfWeek,
          isOpen: true,
          openTime: "09:30",
          closeTime: "21:30",
        })),
      });

      await tx.salonSettings.create({
        data: {
          organizationId: organization.id,
          branchId: branch.id,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: organization.id,
          branchId: branch.id,
          actorType: "OWNER",
          actorId: user.id,
          action: "ORGANIZATION_REGISTERED",
          entityType: "Organization",
          entityId: organization.id,
          ipAddressHash: params.ipAddressHash ?? null,
          userAgent: params.userAgent?.slice(0, 256) ?? null,
          metadata: {
            salonSlug: organization.slug,
            branchSlug: branch.slug,
            initialStatus: organization.status,
          },
        },
      });

      return {
        organizationId: organization.id,
        salonSlug: organization.slug,
        branchId: branch.id,
        branchSlug: branch.slug,
        userId: user.id,
        status: organization.status === "PENDING" ? "PENDING" : "ACTIVE",
        requiresEmailVerification: true,
        ...(process.env.NODE_ENV !== "production"
          ? {
              devVerificationPath: `/api/auth/verify-email?token=${encodeURIComponent(rawVerificationToken)}`,
            }
          : {}),
      };
    }, params.client);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ConflictError(
        "SLUG_TAKEN",
        "An organization with this email or URL slug already exists.",
      );
    }
    throw error;
  }

  if (params.onVerificationTokenCreated) {
    await params.onVerificationTokenCreated({
      email: normalizedEmail,
      token: rawVerificationToken,
    });
  } else if (process.env.NODE_ENV !== "production") {
    logger.info(
      {
        module: "onboarding",
        organizationId: result.organizationId,
        verifyPath: `/api/auth/verify-email?token=${rawVerificationToken}`,
      },
      "Salon registered; email verification pending (dev log)",
    );
  }

  return result;
}

export async function verifyEmailToken(params: {
  token: string;
  ipAddressHash?: string;
  userAgent?: string;
  now?: Date;
  client?: DbClient;
}): Promise<{ verified: true; email: string }> {
  const now = params.now ?? new Date();
  const tokenHash = hashVerificationToken(params.token);

  return withSystemDb(async (tx) => {
    const user = await tx.user.findFirst({
      where: { emailVerificationTokenHash: tokenHash },
      select: {
        id: true,
        email: true,
        emailVerifiedAt: true,
        emailVerificationExpiresAt: true,
        memberships: {
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { organizationId: true },
        },
      },
    });

    if (
      !user ||
      !user.emailVerificationExpiresAt ||
      user.emailVerificationExpiresAt < now
    ) {
      throw new ValidationError("Verification link is invalid or has expired.");
    }

    await tx.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: now,
        emailVerificationTokenHash: null,
        emailVerificationExpiresAt: null,
      },
    });

    await tx.auditLog.create({
      data: {
        organizationId: user.memberships[0]?.organizationId ?? null,
        actorType: "OWNER",
        actorId: user.id,
        action: "EMAIL_VERIFIED",
        entityType: "User",
        entityId: user.id,
        ipAddressHash: params.ipAddressHash ?? null,
        userAgent: params.userAgent?.slice(0, 256) ?? null,
      },
    });

    return { verified: true, email: user.email };
  }, params.client);
}

export async function resendVerificationEmail(params: {
  email: string;
  ipAddressHash?: string;
  userAgent?: string;
  now?: Date;
  client?: DbClient;
  onVerificationTokenCreated?: (payload: {
    email: string;
    token: string;
  }) => Promise<void> | void;
}): Promise<{ sent: true; devVerificationPath?: string }> {
  const now = params.now ?? new Date();
  const normalizedEmail = params.email.trim().toLowerCase();
  const rawToken = generateOpaqueToken(24);
  const tokenHash = hashVerificationToken(rawToken);
  const expiresAt = new Date(now.getTime() + EMAIL_VERIFY_TTL_MS);

  const issued = await withSystemDb(async (tx) => {
    const user = await tx.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        email: true,
        isActive: true,
        emailVerifiedAt: true,
        memberships: {
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { organizationId: true },
        },
      },
    });

    if (!user || !user.isActive || user.emailVerifiedAt) {
      return false;
    }

    await tx.user.update({
      where: { id: user.id },
      data: {
        emailVerificationTokenHash: tokenHash,
        emailVerificationExpiresAt: expiresAt,
      },
    });

    await tx.auditLog.create({
      data: {
        organizationId: user.memberships[0]?.organizationId ?? null,
        actorType: "OWNER",
        actorId: user.id,
        action: "EMAIL_VERIFICATION_RESENT",
        entityType: "User",
        entityId: user.id,
        ipAddressHash: params.ipAddressHash ?? null,
        userAgent: params.userAgent?.slice(0, 256) ?? null,
      },
    });

    return true;
  }, params.client);

  if (issued) {
    if (params.onVerificationTokenCreated) {
      await params.onVerificationTokenCreated({
        email: normalizedEmail,
        token: rawToken,
      });
    } else if (process.env.NODE_ENV !== "production") {
      logger.info(
        {
          module: "onboarding",
          verifyPath: `/api/auth/verify-email?token=${rawToken}`,
        },
        "Re-issued email verification link (dev log)",
      );
    }
  }

  return {
    sent: true,
    ...(issued && process.env.NODE_ENV !== "production"
      ? {
          devVerificationPath: `/api/auth/verify-email?token=${encodeURIComponent(rawToken)}`,
        }
      : {}),
  };
}
