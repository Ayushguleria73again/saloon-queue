import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";

// Load test constants
const LOAD_TEST_ORGS = [
  {
    key: "load1",
    orgId: "88888888-1111-4000-8000-000000000001",
    ownerUserId: "88888888-1111-4000-8000-000000000011",
    ownerRoleId: "88888888-1111-4000-8000-000000000021",
    ownerMemberId: "88888888-1111-4000-8000-000000000031",
    orgName: "Urban Styles Load Test",
    orgSlug: "load-salon-1",
    ownerEmail: "owner.load1@salonflow.test",
    branches: [
      {
        branchId: "88888888-1111-4000-8000-000000000101",
        name: "Indiranagar Flagship",
        slug: "indiranagar",
        city: "Bengaluru",
        prefix: "A",
        allowCustomerCancel: true,
        allowDuplicateActiveTokens: true,
      },
      {
        branchId: "88888888-1111-4000-8000-000000000102",
        name: "Koramangala Express",
        slug: "koramangala",
        city: "Bengaluru",
        prefix: "K",
        allowCustomerCancel: true,
        allowDuplicateActiveTokens: true,
      },
    ],
  },
  {
    key: "load2",
    orgId: "88888888-2222-4000-8000-000000000002",
    ownerUserId: "88888888-2222-4000-8000-000000000012",
    ownerRoleId: "88888888-2222-4000-8000-000000000022",
    ownerMemberId: "88888888-2222-4000-8000-000000000032",
    orgName: "Luxe Cuts Load Test",
    orgSlug: "load-salon-2",
    ownerEmail: "owner.load2@salonflow.test",
    branches: [
      {
        branchId: "88888888-2222-4000-8000-000000000201",
        name: "Bandra Studio",
        slug: "bandra",
        city: "Mumbai",
        prefix: "B",
        allowCustomerCancel: true,
        allowDuplicateActiveTokens: true,
      },
      {
        branchId: "88888888-2222-4000-8000-000000000202",
        name: "Juhu Lounge",
        slug: "juhu",
        city: "Mumbai",
        prefix: "J",
        allowCustomerCancel: true,
        allowDuplicateActiveTokens: true,
      },
    ],
  },
  {
    key: "load3",
    orgId: "88888888-3333-4000-8000-000000000003",
    ownerUserId: "88888888-3333-4000-8000-000000000013",
    ownerRoleId: "88888888-3333-4000-8000-000000000023",
    ownerMemberId: "88888888-3333-4000-8000-000000000033",
    orgName: "Apex Grooming Load Test",
    orgSlug: "load-salon-3",
    ownerEmail: "owner.load3@salonflow.test",
    branches: [
      {
        branchId: "88888888-3333-4000-8000-000000000301",
        name: "Connaught Place",
        slug: "connaught",
        city: "Delhi",
        prefix: "C",
        allowCustomerCancel: true,
        allowDuplicateActiveTokens: true,
      },
      {
        branchId: "88888888-3333-4000-8000-000000000302",
        name: "Cyberhub Gurgaon",
        slug: "cyberhub",
        city: "Gurugram",
        prefix: "G",
        allowCustomerCancel: true,
        allowDuplicateActiveTokens: true,
      },
    ],
  },
];

const OWNER_PERMISSIONS = [
  "QUEUE_VIEW",
  "QUEUE_CREATE_WALKIN",
  "QUEUE_CALL_NEXT",
  "QUEUE_START",
  "QUEUE_COMPLETE",
  "QUEUE_SKIP",
  "QUEUE_CANCEL",
  "QUEUE_NO_SHOW",
  "HISTORY_VIEW",
  "QR_MANAGE",
  "SERVICE_MANAGE",
  "BRANCH_MANAGE",
  "STAFF_MANAGE",
  "SETTINGS_MANAGE",
  "ANALYTICS_VIEW",
];

const DEFAULT_PASSWORD = "LoadTestPass123!";
const AUTH_SECRET =
  process.env.AUTH_SECRET || "dev-only-change-me-to-32-plus-char-random-secret-key";

function hashPasswordScrypt(password: string, salt: string): string {
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${derived}`;
}

function getSeedBusinessDate(): Date {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [yearStr, monthStr, dayStr] = formatted.split("-");
  return new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, Number(dayStr)));
}

async function main() {
  console.log("🚀 Starting Load Test Data Seeding...");
  const prisma = new PrismaClient({
    datasourceUrl: process.env.DIRECT_URL || process.env.DATABASE_URL,
  });

  const businessDate = getSeedBusinessDate();
  const tenantsExport: Array<{
    orgId: string;
    orgName: string;
    orgSlug: string;
    ownerEmail: string;
    ownerPassword: string;
    ownerSessionToken: string;
    branches: Array<{
      branchId: string;
      name: string;
      slug: string;
      prefix: string;
      services: Array<{
        id: string;
        name: string;
        priceInPaise: number;
        durationMinutes: number;
      }>;
    }>;
  }> = [];

  try {
    for (const orgDef of LOAD_TEST_ORGS) {
      console.log(`Setting up organization: ${orgDef.orgName} (${orgDef.orgSlug})`);

      // 1. Organization
      await prisma.organization.upsert({
        where: { id: orgDef.orgId },
        update: {
          name: orgDef.orgName,
          slug: orgDef.orgSlug,
          status: "ACTIVE",
        },
        create: {
          id: orgDef.orgId,
          name: orgDef.orgName,
          slug: orgDef.orgSlug,
          status: "ACTIVE",
        },
      });

      // 2. Owner User
      const passwordSalt = crypto.randomBytes(16).toString("hex");
      const passwordHash = hashPasswordScrypt(DEFAULT_PASSWORD, passwordSalt);

      const ownerUser = await prisma.user.upsert({
        where: { email: orgDef.ownerEmail },
        update: {
          name: `${orgDef.orgName} Owner`,
          passwordHash,
          isActive: true,
          emailVerifiedAt: new Date(),
        },
        create: {
          id: orgDef.ownerUserId,
          name: `${orgDef.orgName} Owner`,
          email: orgDef.ownerEmail,
          passwordHash,
          isActive: true,
          emailVerifiedAt: new Date(),
          sessionVersion: 1,
        },
      });

      // 3. Staff Role (OWNER)
      await prisma.staffRole.upsert({
        where: {
          organizationId_slug: {
            organizationId: orgDef.orgId,
            slug: "OWNER",
          },
        },
        update: {
          name: "Salon Owner",
          isSystemDefault: true,
        },
        create: {
          id: orgDef.ownerRoleId,
          organizationId: orgDef.orgId,
          name: "Salon Owner",
          slug: "OWNER",
          isSystemDefault: true,
        },
      });

      // 4. Role Permissions
      for (const permissionKey of OWNER_PERMISSIONS) {
        await prisma.rolePermission.upsert({
          where: {
            staffRoleId_permissionKey: {
              staffRoleId: orgDef.ownerRoleId,
              permissionKey,
            },
          },
          update: {},
          create: {
            organizationId: orgDef.orgId,
            staffRoleId: orgDef.ownerRoleId,
            permissionKey,
          },
        });
      }

      // 5. Organization Member
      await prisma.organizationMember.upsert({
        where: {
          organizationId_userId: {
            organizationId: orgDef.orgId,
            userId: ownerUser.id,
          },
        },
        update: {
          staffRoleId: orgDef.ownerRoleId,
          allBranches: true,
          status: "ACTIVE",
        },
        create: {
          id: orgDef.ownerMemberId,
          organizationId: orgDef.orgId,
          userId: ownerUser.id,
          staffRoleId: orgDef.ownerRoleId,
          allBranches: true,
          status: "ACTIVE",
        },
      });

      // 6. Services for Organization
      const servicesDef = [
        {
          id: `${orgDef.orgId.slice(0, 24)}000000000401`,
          name: "Quick Haircut",
          description: "Precision haircut and style",
          priceInPaise: 25000,
          durationMinutes: 30,
        },
        {
          id: `${orgDef.orgId.slice(0, 24)}000000000402`,
          name: "Beard Styling",
          description: "Beard trim, shape, and hot towel",
          priceInPaise: 15000,
          durationMinutes: 20,
        },
        {
          id: `${orgDef.orgId.slice(0, 24)}000000000403`,
          name: "Express Facial",
          description: "Refreshing herbal facial treatment",
          priceInPaise: 80000,
          durationMinutes: 45,
        },
      ];

      for (let i = 0; i < servicesDef.length; i++) {
        const s = servicesDef[i]!;
        await prisma.service.upsert({
          where: {
            organizationId_id: {
              organizationId: orgDef.orgId,
              id: s.id,
            },
          },
          update: {
            name: s.name,
            description: s.description,
            basePriceInPaise: s.priceInPaise,
            baseDurationMinutes: s.durationMinutes,
            isActive: true,
            sortOrder: i,
          },
          create: {
            id: s.id,
            organizationId: orgDef.orgId,
            name: s.name,
            description: s.description,
            basePriceInPaise: s.priceInPaise,
            baseDurationMinutes: s.durationMinutes,
            isActive: true,
            sortOrder: i,
          },
        });
      }

      // Pre-compute owner NextAuth session token
      const sessionToken = await encode({
        token: {
          userId: ownerUser.id,
          activeOrganizationId: orgDef.orgId,
          sessionVersion: 1,
          isPlatformAdmin: false,
        },
        secret: AUTH_SECRET,
        salt: "authjs.session-token",
      });

      const branchExports: Array<{
        branchId: string;
        name: string;
        slug: string;
        prefix: string;
        services: Array<{
          id: string;
          name: string;
          priceInPaise: number;
          durationMinutes: number;
        }>;
      }> = [];

      // 7. Branches
      for (const b of orgDef.branches) {
        await prisma.branch.upsert({
          where: {
            organizationId_slug: {
              organizationId: orgDef.orgId,
              slug: b.slug,
            },
          },
          update: {
            name: b.name,
            city: b.city,
            isActive: true,
            timezone: "Asia/Kolkata",
          },
          create: {
            id: b.branchId,
            organizationId: orgDef.orgId,
            name: b.name,
            slug: b.slug,
            city: b.city,
            address: `Test Street, ${b.city}`,
            phone: "9876543210",
            timezone: "Asia/Kolkata",
            qrToken: `qr-${b.slug}`,
            isActive: true,
          },
        });

        // Salon Settings (24x7, allowCustomerCancel, duplicate tokens permitted)
        await prisma.salonSettings.upsert({
          where: {
            organizationId_branchId: {
              organizationId: orgDef.orgId,
              branchId: b.branchId,
            },
          },
          update: {
            tokenPrefix: b.prefix,
            activeStationsCount: 3,
            allowDuplicateActiveTokens: b.allowDuplicateActiveTokens,
            allowCustomerCancel: b.allowCustomerCancel,
            enforceBusinessHours: false,
            isAcceptingTokens: true,
            requireValidQrToken: false,
          },
          create: {
            organizationId: orgDef.orgId,
            branchId: b.branchId,
            tokenPrefix: b.prefix,
            activeStationsCount: 3,
            allowDuplicateActiveTokens: b.allowDuplicateActiveTokens,
            allowCustomerCancel: b.allowCustomerCancel,
            enforceBusinessHours: false,
            isAcceptingTokens: true,
            requireValidQrToken: false,
          },
        });

        // Business Hours: Open 24 hours 7 days/week for load test stability
        for (let day = 0; day <= 6; day++) {
          await prisma.businessHours.upsert({
            where: {
              branchId_dayOfWeek: {
                branchId: b.branchId,
                dayOfWeek: day,
              },
            },
            update: {
              isOpen: true,
              openTime: "00:00",
              closeTime: "23:59",
            },
            create: {
              organizationId: orgDef.orgId,
              branchId: b.branchId,
              dayOfWeek: day,
              isOpen: true,
              openTime: "00:00",
              closeTime: "23:59",
            },
          });
        }

        // Branch Services
        const attachedServices: Array<{
          id: string;
          name: string;
          priceInPaise: number;
          durationMinutes: number;
        }> = [];

        for (let i = 0; i < servicesDef.length; i++) {
          const s = servicesDef[i]!;
          await prisma.branchService.upsert({
            where: {
              branchId_serviceId: {
                branchId: b.branchId,
                serviceId: s.id,
              },
            },
            update: {
              isAvailable: true,
              sortOrder: i,
            },
            create: {
              organizationId: orgDef.orgId,
              branchId: b.branchId,
              serviceId: s.id,
              isAvailable: true,
              sortOrder: i,
            },
          });
          attachedServices.push({
            id: s.id,
            name: s.name,
            priceInPaise: s.priceInPaise,
            durationMinutes: s.durationMinutes,
          });
        }

        // Initialize QueueCounter
        await prisma.queueCounter.upsert({
          where: {
            branchId_businessDate_prefix: {
              branchId: b.branchId,
              businessDate,
              prefix: b.prefix,
            },
          },
          update: {},
          create: {
            organizationId: orgDef.orgId,
            branchId: b.branchId,
            businessDate,
            prefix: b.prefix,
            lastNumber: 0,
          },
        });

        branchExports.push({
          branchId: b.branchId,
          name: b.name,
          slug: b.slug,
          prefix: b.prefix,
          services: attachedServices,
        });
      }

      tenantsExport.push({
        orgId: orgDef.orgId,
        orgName: orgDef.orgName,
        orgSlug: orgDef.orgSlug,
        ownerEmail: orgDef.ownerEmail,
        ownerPassword: DEFAULT_PASSWORD,
        ownerSessionToken: sessionToken,
        branches: branchExports,
      });
    }

    // Write out tests/load/data/test-tenants.json
    const outputDir = path.join(process.cwd(), "tests", "load", "data");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = path.join(outputDir, "test-tenants.json");
    fs.writeFileSync(outputPath, JSON.stringify(tenantsExport, null, 2));
    console.log(`✅ Seed complete! Saved test tenant metadata to ${outputPath}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("❌ Seeding failed:", err);
  process.exit(1);
});
