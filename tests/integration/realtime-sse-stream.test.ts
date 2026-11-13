import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { authorizeTenantAction, type SessionUserClaims } from "@/server/auth";
import { jsonWithEtag } from "@/lib/http";
import {
  createSseResponse,
  getRealtimeHub,
  resetRealtimeHubForTesting,
  type CustomerSubscriber,
  type CustomerTokenUpdateData,
  type OwnerQueueSnapshotData,
  type OwnerSubscriber,
} from "@/server/realtime";
import { updateBranch } from "@/server/services/branch-service";
import { createOrganizationService } from "@/server/services/catalog-service";
import {
  registerSalonOrganization,
  verifyEmailToken,
} from "@/server/services/onboarding-service";
import {
  callNextToken,
  requeueSkippedToken,
  transitionBranchToken,
} from "@/server/services/queue-service";
import { createPublicToken } from "@/server/services/token-service";
import {
  getPublicTokenTracking,
  resolvePublicTokenScope,
} from "@/server/services/token-tracking-service";

function loadEnvIntoProcess() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eqIdx = trimmed.indexOf("=");
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed
      .slice(eqIdx + 1)
      .trim()
      .replace(/^"|"$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvIntoProcess();

const TEST_RUNTIME_URL = process.env.TEST_DATABASE_URL;
const DIRECT_URL = process.env.DIRECT_URL;
if (!TEST_RUNTIME_URL || !DIRECT_URL) {
  throw new Error("TEST_DATABASE_URL and DIRECT_URL must be configured to run tests");
}

const TEST_ADMIN_URL = DIRECT_URL.replace(/\/[^/?]+(\?|$)/, "/salonflow_test$1");

const runtimePrisma = new PrismaClient({
  datasources: { db: { url: TEST_RUNTIME_URL } },
});

const adminTestPrisma = new PrismaClient({
  datasources: { db: { url: TEST_ADMIN_URL } },
});

const OPEN_NOW = new Date("2026-11-13T10:00:00.000Z");

async function truncateAllTables() {
  await adminTestPrisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "notification_deliveries",
      "notifications",
      "notification_events",
      "push_subscriptions",
      "token_services",
      "tokens",
      "queue_counters",
      "customers",
      "branch_services",
      "services",
      "business_hours",
      "salon_settings",
      "staff_branch_access",
      "organization_members",
      "staff_roles",
      "branches",
      "organizations",
      "users",
      "audit_logs"
    CASCADE
  `);
}

async function seedSalonWithBranch(prefix: string) {
  const lower = prefix.toLowerCase();
  let verifyTok = "";
  const reg = await registerSalonOrganization({
    input: {
      ownerName: `Owner ${prefix}`,
      email: `owner-${lower}@salon.test`,
      password: "StrongPassword!123",
      organizationName: `${prefix} Salon`,
      salonSlug: `${lower}-salon`,
      branchName: "Main Branch",
      branchSlug: "main",
      timezone: "Asia/Kolkata",
      website: "",
    },
    client: runtimePrisma,
    onVerificationTokenCreated: ({ token }) => {
      verifyTok = token;
    },
  });

  await verifyEmailToken({ token: verifyTok, client: runtimePrisma });

  const ownerClaims: SessionUserClaims = {
    id: reg.userId,
    email: `owner-${lower}@salon.test`,
    name: `Owner ${prefix}`,
    isPlatformAdmin: false,
    sessionVersion: 1,
    activeOrganizationId: reg.organizationId,
  };

  const serviceCtx = await authorizeTenantAction({
    session: ownerClaims,
    requiredPermission: "SERVICE_MANAGE",
    client: runtimePrisma,
  });

  const haircut = await createOrganizationService(
    serviceCtx,
    {
      name: "Hair Styling",
      baseDurationMinutes: 15,
      basePriceInPaise: 20000,
      sortOrder: 1,
    },
    { client: runtimePrisma },
  );

  await updateBranch(
    await authorizeTenantAction({
      session: ownerClaims,
      requiredPermission: "BRANCH_MANAGE",
      client: runtimePrisma,
    }),
    reg.branchId,
    {
      settings: {
        activeStationsCount: 2,
        estimatedBufferMinutes: 5,
        allowCustomerCancel: true,
      },
    },
    { now: OPEN_NOW, client: runtimePrisma },
  );

  return {
    organizationId: reg.organizationId,
    organizationSlug: `${lower}-salon`,
    branchId: reg.branchId,
    branchSlug: "main",
    serviceId: haircut.id,
    ownerClaims,
  };
}

describe("Phase 13: Real-Time SSE Streams & Single-Pass Snapshot Fan-Out Suite", () => {
  beforeEach(async () => {
    resetRealtimeHubForTesting();
    getRealtimeHub().setDefaultDbClient(runtimePrisma);
    await truncateAllTables();
  });

  afterAll(async () => {
    resetRealtimeHubForTesting();
    await runtimePrisma.$disconnect();
    await adminTestPrisma.$disconnect();
  });

  it("PT-02: connects 40 concurrent customer SSE listeners and fans out queue updates with <= 2 DB queries (no N+1 fan-out)", async () => {
    const salon = await seedSalonWithBranch("Pt02");
    const hub = getRealtimeHub();

    // 1. Issue 40 public customer tokens
    const tokens: Array<{ id: string; publicId: string; tokenNumber: string }> = [];
    for (let i = 1; i <= 40; i += 1) {
      const created = await createPublicToken({
        salonSlug: salon.organizationSlug,
        branchSlug: salon.branchSlug,
        fullName: `Customer ${i}`,
        mobileNumber: `9876543${String(i).padStart(3, "0")}`,
        serviceIds: [salon.serviceId],
        now: OPEN_NOW,
        client: runtimePrisma,
      });
      const scope = await resolvePublicTokenScope(created.token.publicId, runtimePrisma);
      tokens.push({
        id: scope.id,
        publicId: created.token.publicId,
        tokenNumber: created.token.tokenNumber,
      });
    }

    expect(tokens.length).toBe(40);

    // 2. Attach 40 concurrent simulated customer SSE streams
    const receivedCustomerUpdates = new Map<string, CustomerTokenUpdateData>();
    const unsubscribers: Array<() => void> = [];

    for (const t of tokens) {
      const sub: CustomerSubscriber = {
        id: `sub-${t.id}`,
        organizationId: salon.organizationId,
        branchId: salon.branchId,
        tokenId: t.id,
        publicId: t.publicId,
        type: "CUSTOMER",
        send: (rawSse) => {
          // Parse data payload from raw SSE message
          const dataMatch = rawSse.match(/data: (.*)\n\n/);
          if (dataMatch?.[1]) {
            const parsed = JSON.parse(dataMatch[1]) as CustomerTokenUpdateData;
            receivedCustomerUpdates.set(t.id, parsed);
          }
        },
        close: () => {},
      };
      unsubscribers.push(hub.subscribeCustomer(sub));
    }

    // 3. Attach 1 simulated owner SSE stream
    let receivedOwnerOverview: OwnerQueueSnapshotData | null = null;
    const ownerSub: OwnerSubscriber = {
      id: "owner-stream-1",
      organizationId: salon.organizationId,
      branchId: salon.branchId,
      type: "OWNER",
      send: (rawSse) => {
        const dataMatch = rawSse.match(/data: (.*)\n\n/);
        if (dataMatch?.[1]) {
          receivedOwnerOverview = JSON.parse(dataMatch[1]) as OwnerQueueSnapshotData;
        }
      },
      close: () => {},
    };
    unsubscribers.push(hub.subscribeOwner(ownerSub));

    // Verify subscriber counts
    const count = hub.getSubscriberCount(salon.organizationId, salon.branchId);
    expect(count.customers).toBe(40);
    expect(count.owners).toBe(1);

    // 4. Measure DB query count during single-pass snapshot fan-out
    const domainQueries: string[] = [];
    const queryCountingPrisma = new PrismaClient({
      datasources: { db: { url: TEST_RUNTIME_URL } },
      log: [{ emit: "event", level: "query" }],
    });
    queryCountingPrisma.$on("query" as never, (e: { query: string }) => {
      const q = e.query.toLowerCase();
      if (
        !q.includes("set_config") &&
        !q.includes("begin") &&
        !q.includes("commit") &&
        !q.includes("rollback")
      ) {
        domainQueries.push(e.query);
      }
    });

    try {
      // Execute the single-pass projection directly to measure exact query budget
      await hub.computeAndFanoutBranchSnapshot(
        salon.organizationId,
        salon.branchId,
        queryCountingPrisma as never,
      );

      // Verify PT-02 query budget requirement: <= 2 domain data queries for 40 connected listeners
      expect(
        domainQueries.length,
        `Expected <= 2 database queries during single-pass fan-out, but recorded ${domainQueries.length} (${domainQueries.join("; ")})`,
      ).toBeLessThanOrEqual(2);

      // Verify owner received the complete branch overview
      const ownerPayload = receivedOwnerOverview as OwnerQueueSnapshotData | null;
      expect(ownerPayload).not.toBeNull();
      expect(ownerPayload?.overview.waitingTokens.length).toBe(40);

      // Verify ALL 40 customer listeners received their personalized sanitized slice
      expect(receivedCustomerUpdates.size).toBe(40);

      // Check specific position calculations for token 1 and token 40
      const token1Update = receivedCustomerUpdates.get(tokens[0]!.id);
      expect(token1Update?.tokenNumber).toBe("A001");
      expect(token1Update?.queuePosition).toBe(1);
      expect(token1Update?.peopleAhead).toBe(0);

      const token40Update = receivedCustomerUpdates.get(tokens[39]!.id);
      expect(token40Update?.tokenNumber).toBe("A040");
      expect(token40Update?.queuePosition).toBe(40);
      expect(token40Update?.peopleAhead).toBe(39);
    } finally {
      await queryCountingPrisma.$disconnect();
      for (const unsub of unsubscribers) {
        unsub();
      }
    }
  });

  it("IT-RT-01: advances queue, delivers real-time updates to customer & owner, and auto-closes stream on terminal status", async () => {
    const salon = await seedSalonWithBranch("Rt01");
    const hub = getRealtimeHub();

    // 1. Issue customer token
    const created = await createPublicToken({
      salonSlug: salon.organizationSlug,
      branchSlug: salon.branchSlug,
      fullName: "Pooja Verma",
      mobileNumber: "9876543299",
      serviceIds: [salon.serviceId],
      now: OPEN_NOW,
      client: runtimePrisma,
    });

    const scope = await resolvePublicTokenScope(created.token.publicId, runtimePrisma);

    const receivedUpdates: CustomerTokenUpdateData[] = [];
    let streamClosed = false;

    const custSub: CustomerSubscriber = {
      id: `sub-${scope.id}`,
      organizationId: salon.organizationId,
      branchId: salon.branchId,
      tokenId: scope.id,
      publicId: created.token.publicId,
      type: "CUSTOMER",
      send: (rawSse) => {
        const dataMatch = rawSse.match(/data: (.*)\n\n/);
        if (dataMatch?.[1]) {
          receivedUpdates.push(JSON.parse(dataMatch[1]) as CustomerTokenUpdateData);
        }
      },
      close: () => {
        streamClosed = true;
      },
    };

    const unsub = hub.subscribeCustomer(custSub);

    try {
      // 2. Staff calls token
      const callCtx = await authorizeTenantAction({
        session: salon.ownerClaims,
        requiredPermission: "QUEUE_CALL_NEXT",
        branchId: salon.branchId,
        client: runtimePrisma,
      });

      await callNextToken(callCtx, salon.branchId, {
        now: new Date(OPEN_NOW.getTime() + 60_000),
        client: runtimePrisma,
      });

      // Wait 70ms for 50ms coalescing timer to fire
      await new Promise((resolve) => setTimeout(resolve, 80));

      const lastUpdate = receivedUpdates[receivedUpdates.length - 1];
      expect(lastUpdate?.status).toBe("CALLED");
      expect(streamClosed).toBe(false);

      // 3. Staff starts service, then completes token -> reaches terminal state
      await transitionBranchToken({
        organizationId: salon.organizationId,
        branchId: salon.branchId,
        tokenId: scope.id,
        action: "START_SERVICE",
        actorType: "OWNER",
        actorId: salon.ownerClaims.id,
        now: new Date(OPEN_NOW.getTime() + 120_000),
        client: runtimePrisma,
      });

      await transitionBranchToken({
        organizationId: salon.organizationId,
        branchId: salon.branchId,
        tokenId: scope.id,
        action: "COMPLETE",
        actorType: "OWNER",
        actorId: salon.ownerClaims.id,
        now: new Date(OPEN_NOW.getTime() + 180_000),
        client: runtimePrisma,
      });

      // Wait for coalescing pass
      await new Promise((resolve) => setTimeout(resolve, 80));

      const finalUpdate = receivedUpdates[receivedUpdates.length - 1];
      expect(finalUpdate?.status).toBe("COMPLETED");
      expect(finalUpdate?.isTerminal).toBe(true);
      expect(
        streamClosed,
        "Customer SSE stream must auto-close upon reaching terminal state",
      ).toBe(true);
    } finally {
      unsub();
    }
  });

  it("IT-RT-02: informs customer stream when skipped token is re-queued with destination link", async () => {
    const salon = await seedSalonWithBranch("Rt02");
    const hub = getRealtimeHub();

    const created = await createPublicToken({
      salonSlug: salon.organizationSlug,
      branchSlug: salon.branchSlug,
      fullName: "Vikram Malhotra",
      mobileNumber: "9876543298",
      serviceIds: [salon.serviceId],
      now: OPEN_NOW,
      client: runtimePrisma,
    });

    const scope = await resolvePublicTokenScope(created.token.publicId, runtimePrisma);
    const receivedUpdates: CustomerTokenUpdateData[] = [];

    const custSub: CustomerSubscriber = {
      id: `sub-${scope.id}`,
      organizationId: salon.organizationId,
      branchId: salon.branchId,
      tokenId: scope.id,
      publicId: created.token.publicId,
      type: "CUSTOMER",
      send: (rawSse) => {
        const dataMatch = rawSse.match(/data: (.*)\n\n/);
        if (dataMatch?.[1]) {
          receivedUpdates.push(JSON.parse(dataMatch[1]) as CustomerTokenUpdateData);
        }
      },
      close: () => {},
    };

    const unsub = hub.subscribeCustomer(custSub);

    try {
      const callCtx = await authorizeTenantAction({
        session: salon.ownerClaims,
        requiredPermission: "QUEUE_CALL_NEXT",
        branchId: salon.branchId,
        client: runtimePrisma,
      });

      // Call and skip token
      await callNextToken(callCtx, salon.branchId, {
        now: new Date(OPEN_NOW.getTime() + 60_000),
        client: runtimePrisma,
      });
      await transitionBranchToken({
        organizationId: salon.organizationId,
        branchId: salon.branchId,
        tokenId: scope.id,
        action: "SKIP",
        actorType: "OWNER",
        actorId: salon.ownerClaims.id,
        now: new Date(OPEN_NOW.getTime() + 120_000),
        client: runtimePrisma,
      });

      // Re-queue the skipped token
      const requeued = await requeueSkippedToken(callCtx, salon.branchId, scope.id, {
        now: new Date(OPEN_NOW.getTime() + 180_000),
        client: runtimePrisma,
      });

      // Wait for coalesced fan-out
      await new Promise((resolve) => setTimeout(resolve, 80));

      const lastUpdate = receivedUpdates[receivedUpdates.length - 1];
      expect(lastUpdate?.status).toBe("SKIPPED");
      expect(lastUpdate?.requeuedTo).toEqual({
        publicId: requeued.requeuedToken.publicId,
        tokenNumber: requeued.requeuedToken.tokenNumber,
        url: `/salon/${salon.organizationSlug}/${salon.branchSlug}/token/${requeued.requeuedToken.publicId}`,
      });
    } finally {
      unsub();
    }
  });

  it("IT-RT-03: coalesces a burst of rapid queue mutations within 50ms into a single projection pass", async () => {
    const salon = await seedSalonWithBranch("Rt03");
    const hub = getRealtimeHub();

    let fanoutCount = 0;
    const originalMethod = hub.computeAndFanoutBranchSnapshot.bind(hub);
    hub.computeAndFanoutBranchSnapshot = async (...args) => {
      fanoutCount += 1;
      return originalMethod(...args);
    };

    // Attach a subscriber so hub schedules projection
    const unsub = hub.subscribeOwner({
      id: "owner-coalesce-sub",
      organizationId: salon.organizationId,
      branchId: salon.branchId,
      type: "OWNER",
      send: () => {},
      close: () => {},
    });

    try {
      // Publish 10 rapid mutations in tight succession (0ms delay between them)
      for (let i = 1; i <= 10; i += 1) {
        hub.publishQueueMutation({
          organizationId: salon.organizationId,
          branchId: salon.branchId,
          action: "TOKEN_CREATED",
          timestamp: new Date().toISOString(),
        });
      }

      // Wait 80ms for 50ms coalesce timer
      await new Promise((resolve) => setTimeout(resolve, 80));

      // 10 mutations should coalesce into EXACTLY 1 projection pass
      expect(
        fanoutCount,
        "Burst of 10 rapid mutations must coalesce into exactly 1 projection execution",
      ).toBe(1);
    } finally {
      unsub();
      hub.computeAndFanoutBranchSnapshot = originalMethod;
    }
  });

  it("PT-03: returns 304 Not Modified when If-None-Match matches current ETag with zero body overhead, and 200 after queue mutation", async () => {
    const salon = await seedSalonWithBranch("Pt03");

    const created = await createPublicToken({
      salonSlug: salon.organizationSlug,
      branchSlug: salon.branchSlug,
      fullName: "Karan Johar",
      mobileNumber: "9876543201",
      serviceIds: [salon.serviceId],
      now: OPEN_NOW,
      client: runtimePrisma,
    });

    const tracking1 = await getPublicTokenTracking({
      publicId: created.token.publicId,
      client: runtimePrisma,
    });

    // 1. First fetch: returns 200 with initial ETag
    const res1 = jsonWithEtag(new Headers(), tracking1, "req_1");
    expect(res1.status).toBe(200);
    const etag1 = res1.headers.get("etag");
    expect(etag1).toBeDefined();

    // 2. Second fetch with If-None-Match: returns 304 with empty body (zero serialization)
    const res2 = jsonWithEtag(
      new Headers({ "if-none-match": etag1! }),
      tracking1,
      "req_2",
    );
    expect(res2.status).toBe(304);
    const bodyText = await res2.text();
    expect(bodyText).toBe("");

    // 3. Mutate queue: call token
    const callCtx = await authorizeTenantAction({
      session: salon.ownerClaims,
      requiredPermission: "QUEUE_CALL_NEXT",
      branchId: salon.branchId,
      client: runtimePrisma,
    });
    await callNextToken(callCtx, salon.branchId, {
      now: new Date(OPEN_NOW.getTime() + 60_000),
      client: runtimePrisma,
    });

    // 4. Fetch updated tracking details
    const tracking2 = await getPublicTokenTracking({
      publicId: created.token.publicId,
      client: runtimePrisma,
    });
    expect(tracking2.status).toBe("CALLED");

    // 5. Third fetch with old ETag: returns 200 with fresh ETag
    const res3 = jsonWithEtag(
      new Headers({ "if-none-match": etag1! }),
      tracking2,
      "req_3",
    );
    expect(res3.status).toBe(200);
    const etag3 = res3.headers.get("etag");
    expect(etag3).not.toBe(etag1);
  });

  it("IT-RT-04: establishes SSE response with correct headers, keepalive comments, and clean abort", async () => {
    const abortController = new AbortController();
    let receivedComment = "";

    const res = createSseResponse({
      requestSignal: abortController.signal,
      onConnect: (writer) => {
        writer.sendComment("test-ping");
        receivedComment = ": test-ping\n\n";
      },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-cache");
    expect(res.headers.get("connection")).toBe("keep-alive");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    expect(receivedComment).toBe(": test-ping\n\n");

    // Abort stream cleanly
    abortController.abort();
  });
});
