import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint();

async function getRestrictedImportErrors(
  code: string,
  filePath: string,
): Promise<string[]> {
  const results = await eslint.lintText(code, { filePath });
  return (results[0]?.messages ?? [])
    .filter((m) => m.ruleId === "no-restricted-imports")
    .map((m) => m.message);
}

describe("ESLint architectural boundary enforcement", () => {
  it("forbids Next.js request/navigation hooks inside src/server/services/*", async () => {
    const messages = await getRestrictedImportErrors(
      'import { headers } from "next/headers";\nexport const readHeaders = headers;\n',
      "src/server/services/queue-service.ts",
    );

    expect(messages.length).toBeGreaterThan(0);
  });

  it("forbids raw Prisma client and direct PrismaClient imports inside src/server/services/*", async () => {
    const rawClientMsgs = await getRestrictedImportErrors(
      'import { internalPrisma } from "@/server/db/client";\nexport const db = internalPrisma;\n',
      "src/server/services/token-service.ts",
    );
    const prismaCtorMsgs = await getRestrictedImportErrors(
      'import { PrismaClient } from "@prisma/client";\nexport const db = new PrismaClient();\n',
      "src/server/services/token-service.ts",
    );

    expect(rawClientMsgs.length).toBeGreaterThan(0);
    expect(prismaCtorMsgs.length).toBeGreaterThan(0);
  });

  it("forbids raw internalPrisma or PrismaClient imports inside src/app/**", async () => {
    const rawClientMsgs = await getRestrictedImportErrors(
      'import { internalPrisma } from "@/server/db/client";\nexport const GET = () => internalPrisma;\n',
      "src/app/api/tokens/route.ts",
    );
    const prismaCtorMsgs = await getRestrictedImportErrors(
      'import { PrismaClient } from "@prisma/client";\nexport const db = new PrismaClient();\n',
      "src/app/api/tokens/route.ts",
    );

    expect(rawClientMsgs.length).toBeGreaterThan(0);
    expect(prismaCtorMsgs.length).toBeGreaterThan(0);
  });

  it("allows Prisma enum/type imports inside src/server/services/*", async () => {
    const messages = await getRestrictedImportErrors(
      'import { TokenStatus } from "@prisma/client";\nexport const initial = TokenStatus.WAITING;\n',
      "src/server/services/token-service.ts",
    );

    expect(messages).toEqual([]);
  });
});
