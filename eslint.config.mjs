import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "coverage/**",
      "playwright-report/**",
      "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    files: ["src/components/**/*.{ts,tsx}", "src/features/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/server/*", "**/server/*"],
              message:
                "UI and feature modules must not import server modules directly. Use API contracts or server actions.",
            },
            {
              group: ["@prisma/client", "@prisma/client/*"],
              message:
                "React components and feature modules must never import Prisma directly.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@prisma/client",
              importNames: ["PrismaClient"],
              message:
                "App routes and pages must use domain services or @/server/db wrappers, never instantiate PrismaClient directly.",
            },
          ],
          patterns: [
            {
              group: ["@/server/db/client", "**/db/client"],
              message:
                "App routes and pages must invoke domain services or withTenantDb/withSystemDb, never the raw internal Prisma client.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/server/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["next/headers", "next/navigation"],
              message:
                "Domain server layers must remain transport-agnostic and not depend on Next.js UI/request hooks.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/server/services/**/*.{ts,tsx}"],
    rules: {
      // ESLint flat config replaces rule definitions of the same name across matching blocks,
      // so include both the transport-agnostic and tenant-DB restrictions together here.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@prisma/client",
              importNames: ["PrismaClient"],
              message:
                "Tenant services must use withTenantDb/withBranchDb from @/server/db, never instantiate PrismaClient directly.",
            },
          ],
          patterns: [
            {
              group: ["next/headers", "next/navigation"],
              message:
                "Domain server layers must remain transport-agnostic and not depend on Next.js UI/request hooks.",
            },
            {
              group: ["@/server/db/client", "**/db/client"],
              message:
                "Tenant services must use withTenantDb/withBranchDb from @/server/db, never the raw internal Prisma client.",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
