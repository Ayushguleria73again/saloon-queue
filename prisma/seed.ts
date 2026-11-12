import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";

const SEED_IDS = {
  platformAdminUser: "00000000-0000-4000-8000-000000000001",

  // Organization A: Aura Grooming Co.
  orgA: "11111111-1111-4111-8111-111111111100",
  ownerAUser: "11111111-1111-4111-8111-111111111101",
  staffA1User: "11111111-1111-4111-8111-111111111102",
  roleAOwner: "11111111-1111-4111-8111-111111111111",
  roleAManager: "11111111-1111-4111-8111-111111111112",
  roleAStaff: "11111111-1111-4111-8111-111111111113",
  memberAOwner: "11111111-1111-4111-8111-111111111121",
  memberAStaff1: "11111111-1111-4111-8111-111111111122",
  branchA1: "11111111-1111-4111-8111-111111111131",
  branchA2: "11111111-1111-4111-8111-111111111132",
  serviceAHaircut: "11111111-1111-4111-8111-111111111141",
  serviceABeard: "11111111-1111-4111-8111-111111111142",
  serviceAFacial: "11111111-1111-4111-8111-111111111143",
  customerA1: "11111111-1111-4111-8111-111111111151",
  customerA2: "11111111-1111-4111-8111-111111111152",
  tokenA1: "11111111-1111-4111-8111-111111111161",
  tokenA2: "11111111-1111-4111-8111-111111111162",

  // Organization B: Urban Trim Studio
  orgB: "22222222-2222-4222-8222-222222222200",
  ownerBUser: "22222222-2222-4222-8222-222222222201",
  roleBOwner: "22222222-2222-4222-8222-222222222211",
  roleBManager: "22222222-2222-4222-8222-222222222212",
  roleBStaff: "22222222-2222-4222-8222-222222222213",
  memberBOwner: "22222222-2222-4222-8222-222222222221",
  branchB1: "22222222-2222-4222-8222-222222222231",
  serviceBFade: "22222222-2222-4222-8222-222222222241",
  serviceBMassage: "22222222-2222-4222-8222-222222222242",
  customerB1: "22222222-2222-4222-8222-222222222251",
  tokenB1: "22222222-2222-4222-8222-222222222261",
} as const;

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
] as const;

const MANAGER_PERMISSIONS = [
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
  "ANALYTICS_VIEW",
] as const;

const STAFF_PERMISSIONS = [
  "QUEUE_VIEW",
  "QUEUE_CREATE_WALKIN",
  "QUEUE_CALL_NEXT",
  "QUEUE_START",
  "QUEUE_COMPLETE",
  "QUEUE_SKIP",
  "QUEUE_CANCEL",
  "QUEUE_NO_SHOW",
  "HISTORY_VIEW",
] as const;

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

async function upsertOrgDefaultSettings(
  prisma: PrismaClient,
  organizationId: string,
  allowCustomerCancel: boolean,
) {
  const existing = await prisma.salonSettings.findFirst({
    where: { organizationId, branchId: null },
    select: { id: true },
  });

  if (existing) {
    await prisma.salonSettings.update({
      where: { id: existing.id },
      data: { allowCustomerCancel },
    });
    return;
  }

  await prisma.salonSettings.create({
    data: {
      organizationId,
      branchId: null,
      activeStationsCount: 1,
      allowCustomerCancel,
    },
  });
}

async function seedDefaultRoles(
  prisma: PrismaClient,
  organizationId: string,
  roleIds: { owner: string; manager: string; staff: string },
) {
  const roles = [
    { id: roleIds.owner, name: "Owner", slug: "OWNER", perms: OWNER_PERMISSIONS },
    { id: roleIds.manager, name: "Manager", slug: "MANAGER", perms: MANAGER_PERMISSIONS },
    { id: roleIds.staff, name: "Staff", slug: "STAFF", perms: STAFF_PERMISSIONS },
  ];

  for (const role of roles) {
    await prisma.staffRole.upsert({
      where: { organizationId_slug: { organizationId, slug: role.slug } },
      update: { name: role.name, isSystemDefault: true },
      create: {
        id: role.id,
        organizationId,
        name: role.name,
        slug: role.slug,
        isSystemDefault: true,
      },
    });

    for (const permissionKey of role.perms) {
      await prisma.rolePermission.upsert({
        where: {
          staffRoleId_permissionKey: { staffRoleId: role.id, permissionKey },
        },
        update: {},
        create: {
          organizationId,
          staffRoleId: role.id,
          permissionKey,
        },
      });
    }
  }
}

async function seedBusinessHours(
  prisma: PrismaClient,
  organizationId: string,
  branchId: string,
) {
  for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek += 1) {
    await prisma.businessHours.upsert({
      where: { branchId_dayOfWeek: { branchId, dayOfWeek } },
      update: {},
      create: {
        organizationId,
        branchId,
        dayOfWeek,
        isOpen: true,
        openTime: "09:30",
        closeTime: "21:30",
      },
    });
  }
}

export async function runSeed(): Promise<void> {
  const adminUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!adminUrl) {
    throw new Error("DIRECT_URL or DATABASE_URL must be set to run seed");
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: adminUrl } },
  });

  const businessDate = getSeedBusinessDate();
  const verifiedAt = new Date();

  try {
    // 1. Platform Administrator
    await prisma.user.upsert({
      where: { email: "admin@salonflow.local" },
      update: { name: "Platform Admin", isPlatformAdmin: true, isActive: true },
      create: {
        id: SEED_IDS.platformAdminUser,
        name: "Platform Admin",
        email: "admin@salonflow.local",
        emailVerifiedAt: verifiedAt,
        passwordHash: hashPasswordScrypt("AdminDev!2026", "salonflow_admin_salt"),
        isPlatformAdmin: true,
        isActive: true,
      },
    });

    // 2. Organization A: Aura Grooming Co. (2 Branches: Koramangala & Indiranagar)
    await prisma.organization.upsert({
      where: { slug: "aura-grooming" },
      update: { name: "Aura Grooming Co.", status: "ACTIVE" },
      create: {
        id: SEED_IDS.orgA,
        name: "Aura Grooming Co.",
        slug: "aura-grooming",
        status: "ACTIVE",
      },
    });

    await prisma.user.upsert({
      where: { email: "neha@auragrooming.local" },
      update: { name: "Neha Kapoor", isActive: true },
      create: {
        id: SEED_IDS.ownerAUser,
        name: "Neha Kapoor",
        email: "neha@auragrooming.local",
        emailVerifiedAt: verifiedAt,
        passwordHash: hashPasswordScrypt("OwnerADev!2026", "aura_owner_salt"),
        isPlatformAdmin: false,
        isActive: true,
      },
    });

    await prisma.user.upsert({
      where: { email: "suresh@auragrooming.local" },
      update: { name: "Suresh Reddy", isActive: true },
      create: {
        id: SEED_IDS.staffA1User,
        name: "Suresh Reddy",
        email: "suresh@auragrooming.local",
        emailVerifiedAt: verifiedAt,
        passwordHash: hashPasswordScrypt("StaffADev!2026", "aura_staff_salt"),
        isPlatformAdmin: false,
        isActive: true,
      },
    });

    await seedDefaultRoles(prisma, SEED_IDS.orgA, {
      owner: SEED_IDS.roleAOwner,
      manager: SEED_IDS.roleAManager,
      staff: SEED_IDS.roleAStaff,
    });

    await prisma.organizationMember.upsert({
      where: {
        organizationId_userId: {
          organizationId: SEED_IDS.orgA,
          userId: SEED_IDS.ownerAUser,
        },
      },
      update: { status: "ACTIVE", allBranches: true },
      create: {
        id: SEED_IDS.memberAOwner,
        organizationId: SEED_IDS.orgA,
        userId: SEED_IDS.ownerAUser,
        staffRoleId: SEED_IDS.roleAOwner,
        allBranches: true,
        status: "ACTIVE",
      },
    });

    await prisma.organizationMember.upsert({
      where: {
        organizationId_userId: {
          organizationId: SEED_IDS.orgA,
          userId: SEED_IDS.staffA1User,
        },
      },
      update: { status: "ACTIVE", allBranches: false },
      create: {
        id: SEED_IDS.memberAStaff1,
        organizationId: SEED_IDS.orgA,
        userId: SEED_IDS.staffA1User,
        staffRoleId: SEED_IDS.roleAStaff,
        allBranches: false,
        status: "ACTIVE",
      },
    });

    await prisma.branch.upsert({
      where: {
        organizationId_slug: { organizationId: SEED_IDS.orgA, slug: "koramangala" },
      },
      update: { name: "Koramangala", isActive: true },
      create: {
        id: SEED_IDS.branchA1,
        organizationId: SEED_IDS.orgA,
        name: "Koramangala",
        slug: "koramangala",
        phone: "9880011223",
        address: "80 Feet Road, 4th Block",
        city: "Bengaluru",
        timezone: "Asia/Kolkata",
        qrToken: "aura_krm_qr_v1",
        isActive: true,
      },
    });

    await prisma.branch.upsert({
      where: {
        organizationId_slug: { organizationId: SEED_IDS.orgA, slug: "indiranagar" },
      },
      update: { name: "Indiranagar", isActive: true },
      create: {
        id: SEED_IDS.branchA2,
        organizationId: SEED_IDS.orgA,
        name: "Indiranagar",
        slug: "indiranagar",
        phone: "9880044556",
        address: "100 Feet Road, HAL 2nd Stage",
        city: "Bengaluru",
        timezone: "Asia/Kolkata",
        qrToken: "aura_ind_qr_v1",
        isActive: true,
      },
    });

    // Staff A1 restricted to Branch A1 only
    await prisma.staffBranchAccess.upsert({
      where: {
        memberId_branchId: {
          memberId: SEED_IDS.memberAStaff1,
          branchId: SEED_IDS.branchA1,
        },
      },
      update: {},
      create: {
        organizationId: SEED_IDS.orgA,
        memberId: SEED_IDS.memberAStaff1,
        branchId: SEED_IDS.branchA1,
      },
    });

    await seedBusinessHours(prisma, SEED_IDS.orgA, SEED_IDS.branchA1);
    await seedBusinessHours(prisma, SEED_IDS.orgA, SEED_IDS.branchA2);

    await upsertOrgDefaultSettings(prisma, SEED_IDS.orgA, true);

    await prisma.salonSettings.upsert({
      where: {
        organizationId_branchId: {
          organizationId: SEED_IDS.orgA,
          branchId: SEED_IDS.branchA1,
        },
      },
      update: { activeStationsCount: 2 },
      create: {
        organizationId: SEED_IDS.orgA,
        branchId: SEED_IDS.branchA1,
        activeStationsCount: 2,
        allowCustomerCancel: true,
      },
    });

    await prisma.salonSettings.upsert({
      where: {
        organizationId_branchId: {
          organizationId: SEED_IDS.orgA,
          branchId: SEED_IDS.branchA2,
        },
      },
      update: { activeStationsCount: 1 },
      create: {
        organizationId: SEED_IDS.orgA,
        branchId: SEED_IDS.branchA2,
        activeStationsCount: 1,
        allowCustomerCancel: true,
      },
    });

    const orgAServices = [
      {
        id: SEED_IDS.serviceAHaircut,
        name: "Classic Haircut",
        description: "Precision cut, wash, and styling",
        basePriceInPaise: 30000,
        baseDurationMinutes: 30,
        sortOrder: 1,
      },
      {
        id: SEED_IDS.serviceABeard,
        name: "Beard Trim & Styling",
        description: "Shape, razor finish, and cooling balm",
        basePriceInPaise: 15000,
        baseDurationMinutes: 15,
        sortOrder: 2,
      },
      {
        id: SEED_IDS.serviceAFacial,
        name: "De-Tan Facial",
        description: "Deep cleanse and glow mask",
        basePriceInPaise: 80000,
        baseDurationMinutes: 45,
        sortOrder: 3,
      },
    ];

    for (const svc of orgAServices) {
      await prisma.service.upsert({
        where: { id: svc.id },
        update: {
          name: svc.name,
          description: svc.description,
          basePriceInPaise: svc.basePriceInPaise,
          baseDurationMinutes: svc.baseDurationMinutes,
          isActive: true,
          sortOrder: svc.sortOrder,
        },
        create: { organizationId: SEED_IDS.orgA, ...svc },
      });

      await prisma.branchService.upsert({
        where: {
          branchId_serviceId: { branchId: SEED_IDS.branchA1, serviceId: svc.id },
        },
        update: { isAvailable: true },
        create: {
          organizationId: SEED_IDS.orgA,
          branchId: SEED_IDS.branchA1,
          serviceId: svc.id,
          isAvailable: true,
          sortOrder: svc.sortOrder,
        },
      });

      await prisma.branchService.upsert({
        where: {
          branchId_serviceId: { branchId: SEED_IDS.branchA2, serviceId: svc.id },
        },
        update: {},
        create: {
          organizationId: SEED_IDS.orgA,
          branchId: SEED_IDS.branchA2,
          serviceId: svc.id,
          isAvailable: true,
          priceOverrideInPaise: svc.id === SEED_IDS.serviceAHaircut ? 35000 : null,
          sortOrder: svc.sortOrder,
        },
      });
    }

    await prisma.customer.upsert({
      where: {
        branchId_mobileNumber: {
          branchId: SEED_IDS.branchA1,
          mobileNumber: "9876543210",
        },
      },
      update: { name: "Rahul Sharma" },
      create: {
        id: SEED_IDS.customerA1,
        organizationId: SEED_IDS.orgA,
        branchId: SEED_IDS.branchA1,
        name: "Rahul Sharma",
        mobileNumber: "9876543210",
      },
    });

    await prisma.customer.upsert({
      where: {
        branchId_mobileNumber: {
          branchId: SEED_IDS.branchA2,
          mobileNumber: "9876500001",
        },
      },
      update: { name: "Ananya Iyer" },
      create: {
        id: SEED_IDS.customerA2,
        organizationId: SEED_IDS.orgA,
        branchId: SEED_IDS.branchA2,
        name: "Ananya Iyer",
        mobileNumber: "9876500001",
      },
    });

    await prisma.queueCounter.upsert({
      where: {
        branchId_businessDate_prefix: {
          branchId: SEED_IDS.branchA1,
          businessDate,
          prefix: "A",
        },
      },
      update: { lastNumber: 1 },
      create: {
        organizationId: SEED_IDS.orgA,
        branchId: SEED_IDS.branchA1,
        businessDate,
        prefix: "A",
        lastNumber: 1,
      },
    });

    await prisma.queueCounter.upsert({
      where: {
        branchId_businessDate_prefix: {
          branchId: SEED_IDS.branchA2,
          businessDate,
          prefix: "A",
        },
      },
      update: { lastNumber: 1 },
      create: {
        organizationId: SEED_IDS.orgA,
        branchId: SEED_IDS.branchA2,
        businessDate,
        prefix: "A",
        lastNumber: 1,
      },
    });

    await prisma.token.upsert({
      where: { publicId: "seed_aura_krm_a001_tok" },
      update: {
        businessDate,
        sequenceNumber: 1,
        tokenNumber: "A001",
        status: "WAITING",
      },
      create: {
        id: SEED_IDS.tokenA1,
        publicId: "seed_aura_krm_a001_tok",
        organizationId: SEED_IDS.orgA,
        branchId: SEED_IDS.branchA1,
        customerId: SEED_IDS.customerA1,
        businessDate,
        sequenceNumber: 1,
        tokenNumber: "A001",
        source: "QR",
        customerNameSnapshot: "Rahul Sharma",
        customerMobileSnapshot: "9876543210",
        status: "WAITING",
        totalPriceInPaise: 45000,
        totalDurationMinutes: 45,
        tokenServices: {
          create: [
            {
              serviceId: SEED_IDS.serviceAHaircut,
              serviceNameSnapshot: "Classic Haircut",
              priceInPaiseSnapshot: 30000,
              durationMinutesSnapshot: 30,
            },
            {
              serviceId: SEED_IDS.serviceABeard,
              serviceNameSnapshot: "Beard Trim & Styling",
              priceInPaiseSnapshot: 15000,
              durationMinutesSnapshot: 15,
            },
          ],
        },
      },
    });

    await prisma.token.upsert({
      where: { publicId: "seed_aura_ind_a001_tok" },
      update: {
        businessDate,
        sequenceNumber: 1,
        tokenNumber: "A001",
        status: "WAITING",
      },
      create: {
        id: SEED_IDS.tokenA2,
        publicId: "seed_aura_ind_a001_tok",
        organizationId: SEED_IDS.orgA,
        branchId: SEED_IDS.branchA2,
        customerId: SEED_IDS.customerA2,
        businessDate,
        sequenceNumber: 1,
        tokenNumber: "A001",
        source: "WALK_IN",
        customerNameSnapshot: "Ananya Iyer",
        customerMobileSnapshot: "9876500001",
        status: "WAITING",
        totalPriceInPaise: 35000,
        totalDurationMinutes: 30,
        tokenServices: {
          create: [
            {
              serviceId: SEED_IDS.serviceAHaircut,
              serviceNameSnapshot: "Classic Haircut",
              priceInPaiseSnapshot: 35000,
              durationMinutesSnapshot: 30,
            },
          ],
        },
      },
    });

    // 3. Organization B: Urban Trim Studio (1 Branch: Bandra West)
    await prisma.organization.upsert({
      where: { slug: "urban-trim" },
      update: { name: "Urban Trim Studio", status: "ACTIVE" },
      create: {
        id: SEED_IDS.orgB,
        name: "Urban Trim Studio",
        slug: "urban-trim",
        status: "ACTIVE",
      },
    });

    await prisma.user.upsert({
      where: { email: "vikram@urbantrim.local" },
      update: { name: "Vikram Desai", isActive: true },
      create: {
        id: SEED_IDS.ownerBUser,
        name: "Vikram Desai",
        email: "vikram@urbantrim.local",
        emailVerifiedAt: verifiedAt,
        passwordHash: hashPasswordScrypt("OwnerBDev!2026", "urban_owner_salt"),
        isPlatformAdmin: false,
        isActive: true,
      },
    });

    await seedDefaultRoles(prisma, SEED_IDS.orgB, {
      owner: SEED_IDS.roleBOwner,
      manager: SEED_IDS.roleBManager,
      staff: SEED_IDS.roleBStaff,
    });

    await prisma.organizationMember.upsert({
      where: {
        organizationId_userId: {
          organizationId: SEED_IDS.orgB,
          userId: SEED_IDS.ownerBUser,
        },
      },
      update: { status: "ACTIVE", allBranches: true },
      create: {
        id: SEED_IDS.memberBOwner,
        organizationId: SEED_IDS.orgB,
        userId: SEED_IDS.ownerBUser,
        staffRoleId: SEED_IDS.roleBOwner,
        allBranches: true,
        status: "ACTIVE",
      },
    });

    await prisma.branch.upsert({
      where: {
        organizationId_slug: { organizationId: SEED_IDS.orgB, slug: "bandra-west" },
      },
      update: { name: "Bandra West", isActive: true },
      create: {
        id: SEED_IDS.branchB1,
        organizationId: SEED_IDS.orgB,
        name: "Bandra West",
        slug: "bandra-west",
        phone: "9820098200",
        address: "Pali Hill Road",
        city: "Mumbai",
        timezone: "Asia/Kolkata",
        qrToken: "urban_bnd_qr_v1",
        isActive: true,
      },
    });

    await seedBusinessHours(prisma, SEED_IDS.orgB, SEED_IDS.branchB1);

    await upsertOrgDefaultSettings(prisma, SEED_IDS.orgB, false);

    await prisma.salonSettings.upsert({
      where: {
        organizationId_branchId: {
          organizationId: SEED_IDS.orgB,
          branchId: SEED_IDS.branchB1,
        },
      },
      update: { activeStationsCount: 2 },
      create: {
        organizationId: SEED_IDS.orgB,
        branchId: SEED_IDS.branchB1,
        activeStationsCount: 2,
        allowCustomerCancel: false,
      },
    });

    const orgBServices = [
      {
        id: SEED_IDS.serviceBFade,
        name: "Signature Fade",
        description: "Skin fade and hair wash",
        basePriceInPaise: 40000,
        baseDurationMinutes: 35,
        sortOrder: 1,
      },
      {
        id: SEED_IDS.serviceBMassage,
        name: "Head Massage",
        description: "Relaxing aromatic oil massage",
        basePriceInPaise: 25000,
        baseDurationMinutes: 20,
        sortOrder: 2,
      },
    ];

    for (const svc of orgBServices) {
      await prisma.service.upsert({
        where: { id: svc.id },
        update: {
          name: svc.name,
          description: svc.description,
          basePriceInPaise: svc.basePriceInPaise,
          baseDurationMinutes: svc.baseDurationMinutes,
          isActive: true,
          sortOrder: svc.sortOrder,
        },
        create: { organizationId: SEED_IDS.orgB, ...svc },
      });

      await prisma.branchService.upsert({
        where: {
          branchId_serviceId: { branchId: SEED_IDS.branchB1, serviceId: svc.id },
        },
        update: { isAvailable: true },
        create: {
          organizationId: SEED_IDS.orgB,
          branchId: SEED_IDS.branchB1,
          serviceId: svc.id,
          isAvailable: true,
          sortOrder: svc.sortOrder,
        },
      });
    }

    await prisma.customer.upsert({
      where: {
        branchId_mobileNumber: {
          branchId: SEED_IDS.branchB1,
          mobileNumber: "9820112233",
        },
      },
      update: { name: "Karan Malhotra" },
      create: {
        id: SEED_IDS.customerB1,
        organizationId: SEED_IDS.orgB,
        branchId: SEED_IDS.branchB1,
        name: "Karan Malhotra",
        mobileNumber: "9820112233",
      },
    });

    await prisma.queueCounter.upsert({
      where: {
        branchId_businessDate_prefix: {
          branchId: SEED_IDS.branchB1,
          businessDate,
          prefix: "A",
        },
      },
      update: { lastNumber: 1 },
      create: {
        organizationId: SEED_IDS.orgB,
        branchId: SEED_IDS.branchB1,
        businessDate,
        prefix: "A",
        lastNumber: 1,
      },
    });

    await prisma.token.upsert({
      where: { publicId: "seed_urban_bnd_a001_tok" },
      update: {
        businessDate,
        sequenceNumber: 1,
        tokenNumber: "A001",
        status: "WAITING",
      },
      create: {
        id: SEED_IDS.tokenB1,
        publicId: "seed_urban_bnd_a001_tok",
        organizationId: SEED_IDS.orgB,
        branchId: SEED_IDS.branchB1,
        customerId: SEED_IDS.customerB1,
        businessDate,
        sequenceNumber: 1,
        tokenNumber: "A001",
        source: "QR",
        customerNameSnapshot: "Karan Malhotra",
        customerMobileSnapshot: "9820112233",
        status: "WAITING",
        totalPriceInPaise: 40000,
        totalDurationMinutes: 35,
        tokenServices: {
          create: [
            {
              serviceId: SEED_IDS.serviceBFade,
              serviceNameSnapshot: "Signature Fade",
              priceInPaiseSnapshot: 40000,
              durationMinutesSnapshot: 35,
            },
          ],
        },
      },
    });

    console.log(
      "Seeded SalonFlow multi-tenant data: Platform Admin, Aura Grooming Co. (2 branches), Urban Trim Studio (1 branch).",
    );
  } finally {
    await prisma.$disconnect();
  }
}

runSeed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
