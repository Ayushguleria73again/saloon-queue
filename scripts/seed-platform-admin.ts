import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
    },
  },
});

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "admin@salonflow.com").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "AdminSecure!2026";
  const name = process.env.ADMIN_NAME ?? "Platform Administrator";

  if (!email || !email.includes("@")) {
    console.error("Error: Valid ADMIN_EMAIL is required.");
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("Error: ADMIN_PASSWORD must be at least 8 characters long.");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const now = new Date();

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      name,
      passwordHash,
      isPlatformAdmin: true,
      isActive: true,
      emailVerifiedAt: now,
      sessionVersion: { increment: 1 },
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
    create: {
      email,
      name,
      passwordHash,
      isPlatformAdmin: true,
      isActive: true,
      emailVerifiedAt: now,
      sessionVersion: 1,
    },
    select: {
      id: true,
      email: true,
      name: true,
      isPlatformAdmin: true,
      isActive: true,
      sessionVersion: true,
    },
  });

  console.log(`[SALONFLOW] Platform Administrator provisioned successfully:`);
  console.log(`  ID: ${user.id}`);
  console.log(`  Email: ${user.email}`);
  console.log(`  Name: ${user.name}`);
  console.log(`  isPlatformAdmin: ${user.isPlatformAdmin}`);
  console.log(`  sessionVersion: ${user.sessionVersion}`);
}

main()
  .catch((err) => {
    console.error("[SALONFLOW] Failed to seed Platform Administrator:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

