import { PrismaClient } from "@prisma/client";

const LOAD_TEST_ORG_IDS = [
  "88888888-1111-4000-8000-000000000001",
  "88888888-2222-4000-8000-000000000002",
  "88888888-3333-4000-8000-000000000003",
];

const LOAD_TEST_USER_EMAILS = [
  "owner.load1@salonflow.test",
  "owner.load2@salonflow.test",
  "owner.load3@salonflow.test",
];

async function main() {
  console.log("🧹 Cleaning up synthetic load test data...");
  const prisma = new PrismaClient({
    datasourceUrl: process.env.DIRECT_URL || process.env.DATABASE_URL,
  });

  try {
    // 1. Delete Tokens for load test orgs
    const deletedTokens = await prisma.token.deleteMany({
      where: {
        organizationId: { in: LOAD_TEST_ORG_IDS },
      },
    });
    console.log(`Deleted ${deletedTokens.count} synthetic load test tokens.`);

    // 2. Delete Customers created for load test orgs
    const deletedCustomers = await prisma.customer.deleteMany({
      where: {
        organizationId: { in: LOAD_TEST_ORG_IDS },
      },
    });
    console.log(`Deleted ${deletedCustomers.count} synthetic customers.`);

    // 3. Reset QueueCounters for load test branches
    const resetCounters = await prisma.queueCounter.updateMany({
      where: {
        organizationId: { in: LOAD_TEST_ORG_IDS },
      },
      data: {
        lastNumber: 0,
      },
    });
    console.log(`Reset ${resetCounters.count} queue counters to 0.`);

    // 4. Delete NotificationDeliveries and NotificationEvents for load test orgs
    await prisma.notificationDelivery.deleteMany({
      where: { organizationId: { in: LOAD_TEST_ORG_IDS } },
    });
    await prisma.notificationEvent.deleteMany({
      where: { organizationId: { in: LOAD_TEST_ORG_IDS } },
    });
    await prisma.notification.deleteMany({
      where: { organizationId: { in: LOAD_TEST_ORG_IDS } },
    });

    // 5. Delete AuditLogs for load test orgs
    await prisma.auditLog.deleteMany({
      where: { organizationId: { in: LOAD_TEST_ORG_IDS } },
    });

    const purgeFullOrgs = process.argv.includes("--purge-all");
    if (purgeFullOrgs) {
      console.log("Purging entire load test organizations, branches, and users...");
      await prisma.organization.deleteMany({
        where: { id: { in: LOAD_TEST_ORG_IDS } },
      });
      await prisma.user.deleteMany({
        where: { email: { in: LOAD_TEST_USER_EMAILS } },
      });
      console.log("Purged load test organizations and users.");
    }

    console.log("✅ Load test cleanup complete.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("❌ Cleanup failed:", err);
  process.exit(1);
});

