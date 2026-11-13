import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import type { Client as PgClientType } from "pg";
import type { TokenStatus } from "@prisma/client";
import type { BranchQueueOverviewDto, QueueTokenItemDto } from "@/features/queue/types";
import { logger } from "@/lib/logger";
import { calculateBranchWaitTimes } from "@/lib/wait-time";
import { withBranchDb, type DbClient } from "@/server/db";
import { formatSseEvent } from "./sse-stream";
import {
  buildBranchChannelKey,
  type CustomerSubscriber,
  type CustomerTokenUpdateData,
  type OwnerQueueSnapshotData,
  type OwnerSubscriber,
  type QueueMutationBroadcast,
} from "./types";

const COALESCE_WINDOW_MS = 50;

function mapToQueueTokenDto(
  token: {
    id: string;
    publicId: string;
    tokenNumber: string;
    sequenceNumber: number;
    status: TokenStatus;
    source: string;
    customerNameSnapshot: string;
    customerMobileSnapshot: string;
    notes: string | null;
    totalPriceInPaise: number;
    totalDurationMinutes: number;
    requeuedFromTokenId: string | null;
    createdAt: Date;
    calledAt: Date | null;
    serviceStartedAt: Date | null;
    skippedAt: Date | null;
  },
  metrics?: {
    estimatedWaitMinutes: number;
    peopleAhead: number;
    queuePosition: number;
  },
): QueueTokenItemDto {
  return {
    id: token.id,
    publicId: token.publicId,
    tokenNumber: token.tokenNumber,
    sequenceNumber: token.sequenceNumber,
    status: token.status,
    source: token.source as "QR" | "WALK_IN",
    customerName: token.customerNameSnapshot,
    customerMobile: token.customerMobileSnapshot,
    notes: token.notes,
    totalPriceInPaise: token.totalPriceInPaise,
    totalDurationMinutes: token.totalDurationMinutes,
    estimatedWaitMinutes: metrics?.estimatedWaitMinutes ?? 0,
    peopleAhead: metrics?.peopleAhead ?? 0,
    queuePosition: metrics?.queuePosition ?? 0,
    requeuedFromTokenId: token.requeuedFromTokenId,
    createdAt: token.createdAt.toISOString(),
    calledAt: token.calledAt ? token.calledAt.toISOString() : null,
    serviceStartedAt: token.serviceStartedAt
      ? token.serviceStartedAt.toISOString()
      : null,
    skippedAt: token.skippedAt ? token.skippedAt.toISOString() : null,
    services: [],
  };
}

export class RealtimeHub {
  private localEmitter: EventEmitter;
  private ownerSubscribers: Map<string, Map<string, OwnerSubscriber>> = new Map();
  private customerSubscribers: Map<string, Map<string, CustomerSubscriber>> = new Map();
  private coalesceTimers: Map<string, NodeJS.Timeout> = new Map();
  private pgClient: PgClientType | null = null;
  private isPgListening = false;
  private defaultClient?: DbClient;

  constructor() {
    this.localEmitter = new EventEmitter();
    this.localEmitter.setMaxListeners(200);

    if (process.env.REALTIME_TRANSPORT === "pg-listen") {
      void this.initPgListen();
    }
  }

  public setDefaultDbClient(client?: DbClient): void {
    this.defaultClient = client;
  }

  private async initPgListen(): Promise<void> {
    const directUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
    if (!directUrl) {
      logger.warn("REALTIME_TRANSPORT=pg-listen but neither DIRECT_URL nor DATABASE_URL is set");
      return;
    }

    try {
      const { Client } = await import("pg");
      const client = new Client({ connectionString: directUrl });
      await client.connect();
      this.pgClient = client;

      await client.query("LISTEN salonflow_queue_events");
      this.isPgListening = true;

      client.on("notification", (msg) => {
        if (msg.channel === "salonflow_queue_events" && msg.payload) {
          try {
            const parsed = JSON.parse(msg.payload) as QueueMutationBroadcast;
            if (parsed.organizationId && parsed.branchId) {
              this.scheduleBranchProjection(parsed.organizationId, parsed.branchId);
            }
          } catch (err) {
            logger.warn({ err }, "Failed to parse PG LISTEN salonflow_queue_events payload");
          }
        }
      });

      client.on("error", (err) => {
        logger.error({ err }, "PG LISTEN client encountered an error; resetting connection");
        this.isPgListening = false;
        this.pgClient = null;
        setTimeout(() => {
          void this.initPgListen();
        }, 5_000);
      });

      logger.info("RealtimeHub successfully subscribed to PostgreSQL LISTEN salonflow_queue_events");
    } catch (err) {
      logger.error({ err }, "Failed to initialize PG LISTEN client; falling back to in-memory mode");
      this.isPgListening = false;
      this.pgClient = null;
    }
  }

  public subscribeOwner(subscriber: OwnerSubscriber): () => void {
    const channelKey = buildBranchChannelKey(subscriber.organizationId, subscriber.branchId);
    let branchMap = this.ownerSubscribers.get(channelKey);
    if (!branchMap) {
      branchMap = new Map();
      this.ownerSubscribers.set(channelKey, branchMap);
    }
    branchMap.set(subscriber.id, subscriber);

    return () => {
      const currentMap = this.ownerSubscribers.get(channelKey);
      if (currentMap) {
        currentMap.delete(subscriber.id);
        if (currentMap.size === 0) {
          this.ownerSubscribers.delete(channelKey);
        }
      }
    };
  }

  public subscribeCustomer(subscriber: CustomerSubscriber): () => void {
    const channelKey = buildBranchChannelKey(subscriber.organizationId, subscriber.branchId);
    let branchMap = this.customerSubscribers.get(channelKey);
    if (!branchMap) {
      branchMap = new Map();
      this.customerSubscribers.set(channelKey, branchMap);
    }
    branchMap.set(subscriber.id, subscriber);

    return () => {
      const currentMap = this.customerSubscribers.get(channelKey);
      if (currentMap) {
        currentMap.delete(subscriber.id);
        if (currentMap.size === 0) {
          this.customerSubscribers.delete(channelKey);
        }
      }
    };
  }

  public hasSubscribers(organizationId: string, branchId: string): boolean {
    const channelKey = buildBranchChannelKey(organizationId, branchId);
    const ownerCount = this.ownerSubscribers.get(channelKey)?.size ?? 0;
    const customerCount = this.customerSubscribers.get(channelKey)?.size ?? 0;
    return ownerCount > 0 || customerCount > 0;
  }

  public getSubscriberCount(organizationId: string, branchId: string): {
    owners: number;
    customers: number;
  } {
    const channelKey = buildBranchChannelKey(organizationId, branchId);
    return {
      owners: this.ownerSubscribers.get(channelKey)?.size ?? 0,
      customers: this.customerSubscribers.get(channelKey)?.size ?? 0,
    };
  }

  public publishQueueMutation(mutation: QueueMutationBroadcast): void {
    if (this.isPgListening && this.pgClient) {
      const payload = JSON.stringify(mutation);
      this.pgClient
        .query("NOTIFY salonflow_queue_events, $1", [payload])
        .catch((err) => {
          logger.warn({ err }, "Failed to send PG NOTIFY salonflow_queue_events");
        });
    }

    this.scheduleBranchProjection(mutation.organizationId, mutation.branchId);
  }

  public scheduleBranchProjection(
    organizationId: string,
    branchId: string,
    client?: DbClient,
  ): void {
    const channelKey = buildBranchChannelKey(organizationId, branchId);

    if (!this.hasSubscribers(organizationId, branchId)) {
      return;
    }

    if (this.coalesceTimers.has(channelKey)) {
      return;
    }

    const timer = setTimeout(() => {
      this.coalesceTimers.delete(channelKey);
      void this.computeAndFanoutBranchSnapshot(organizationId, branchId, client);
    }, COALESCE_WINDOW_MS);

    this.coalesceTimers.set(channelKey, timer);
  }

  public async computeAndFanoutBranchSnapshot(
    organizationId: string,
    branchId: string,
    client?: DbClient,
  ): Promise<void> {
    const channelKey = buildBranchChannelKey(organizationId, branchId);
    const owners = this.ownerSubscribers.get(channelKey);
    const customers = this.customerSubscribers.get(channelKey);

    if ((!owners || owners.size === 0) && (!customers || customers.size === 0)) {
      return;
    }

    const activeClient = client ?? this.defaultClient;

    try {
      await withBranchDb(
        organizationId,
        branchId,
        async (tx) => {
          // Query 1: Branch settings for station simulation and timezone (single joined SQL query)
          const branchRows = await tx.$queryRaw<
            Array<{
              id: string;
              timezone: string;
              active_stations_count: number | null;
              estimated_buffer_minutes: number | null;
            }>
          >`
            SELECT
              b."id",
              b."timezone",
              s."active_stations_count",
              s."estimated_buffer_minutes"
            FROM "branches" b
            LEFT JOIN "salon_settings" s
              ON s."organization_id" = b."organization_id"
             AND (s."branch_id" = b."id" OR s."branch_id" IS NULL)
            WHERE b."id" = ${branchId}::uuid
              AND b."organization_id" = ${organizationId}::uuid
            ORDER BY s."branch_id" NULLS LAST
            LIMIT 1
          `;

          const branchRow = branchRows[0];
          const activeStationsCount = Math.max(1, branchRow?.active_stations_count ?? 1);
          const bufferMinutes = Math.max(0, branchRow?.estimated_buffer_minutes ?? 0);
          const now = new Date();

          // Query 2: All active tokens in this branch (IN_SERVICE, CALLED, WAITING)
          const activeTokens = await tx.token.findMany({
            where: {
              organizationId,
              branchId,
              status: { in: ["IN_SERVICE", "CALLED", "WAITING"] },
            },
            orderBy: [{ sequenceNumber: "asc" }],
            select: {
              id: true,
              publicId: true,
              tokenNumber: true,
              sequenceNumber: true,
              status: true,
              source: true,
              customerNameSnapshot: true,
              customerMobileSnapshot: true,
              notes: true,
              totalPriceInPaise: true,
              totalDurationMinutes: true,
              requeuedFromTokenId: true,
              createdAt: true,
              calledAt: true,
              serviceStartedAt: true,
              skippedAt: true,
            },
          });

          // In-memory station simulation & wait-time projection (pure JS, 0 extra DB queries!)
          const inServiceTokens = activeTokens
            .filter((t) => t.status === "IN_SERVICE")
            .sort(
              (a, b) =>
                (a.serviceStartedAt?.getTime() ?? 0) - (b.serviceStartedAt?.getTime() ?? 0),
            );

          const calledTokens = activeTokens
            .filter((t) => t.status === "CALLED")
            .sort(
              (a, b) =>
                (a.calledAt?.getTime() ?? 0) - (b.calledAt?.getTime() ?? 0) ||
                a.sequenceNumber - b.sequenceNumber,
            );

          const waitingTokens = activeTokens.filter((t) => t.status === "WAITING");

          const waitSimulation = calculateBranchWaitTimes({
            activeStationsCount,
            bufferMinutes,
            overrunFactor: 1.0,
            now,
            inServiceTokens,
            calledTokens,
            waitingTokens,
          });

          const version = crypto.randomUUID();
          const timestamp = now.toISOString();

          // 1. Fan out to owner listeners (full branch queue snapshot)
          if (owners && owners.size > 0) {
            const inServiceDtos = inServiceTokens.map((t) =>
              mapToQueueTokenDto(t, waitSimulation.byTokenId.get(t.id)),
            );
            const calledDtos = calledTokens.map((t) =>
              mapToQueueTokenDto(t, waitSimulation.byTokenId.get(t.id)),
            );
            const waitingDtos = waitingTokens.map((t) =>
              mapToQueueTokenDto(t, waitSimulation.byTokenId.get(t.id)),
            );

            const overview: BranchQueueOverviewDto = {
              branchId,
              businessDate: now.toISOString().slice(0, 10),
              isAcceptingTokens: true,
              queuePausedReason: null,
              activeStationsCount,
              estimatedNewJoinWaitMinutes: waitSimulation.estimatedNewJoinWaitMinutes,
              kpis: {
                totalTokens: activeTokens.length,
                waitingCount: waitingTokens.length,
                calledCount: calledTokens.length,
                inServiceCount: inServiceTokens.length,
                completedCount: 0,
                skippedCount: 0,
                cancelledNoShowCount: 0,
                avgWaitMinutes: 0,
                avgServiceMinutes: 0,
                revenueInPaise: 0,
              },
              inServiceTokens: inServiceDtos,
              calledTokens: calledDtos,
              waitingTokens: waitingDtos,
              skippedTokens: [],
            };

            const ownerPayload: OwnerQueueSnapshotData = {
              version,
              timestamp,
              overview,
            };
            const ownerSse = formatSseEvent({
              event: "queue_snapshot",
              id: version,
              data: ownerPayload,
            });

            for (const owner of owners.values()) {
              try {
                owner.send(ownerSse);
              } catch (err) {
                logger.debug({ err, ownerId: owner.id }, "Error sending SSE to owner");
              }
            }
          }

          // 2. Fan out to customer listeners (sanitized token slice only — zero PII leakage)
          if (customers && customers.size > 0) {
            const activeTokensById = new Map<string, (typeof activeTokens)[number]>();
            for (const t of activeTokens) {
              activeTokensById.set(t.id, t);
            }

            const missingSubscriberTokenIds: string[] = [];
            for (const cust of customers.values()) {
              if (!activeTokensById.has(cust.tokenId)) {
                missingSubscriberTokenIds.push(cust.tokenId);
              }
            }

            // Only query terminal tokens if a subscribed customer's token is no longer in activeTokens
            const terminalTokensMap = new Map<
              string,
              {
                status: CustomerTokenUpdateData["status"];
                requeuedTo: { publicId: string; tokenNumber: string; url: string } | null;
              }
            >();

            if (missingSubscriberTokenIds.length > 0) {
              const fetched = await tx.token.findMany({
                where: {
                  organizationId,
                  branchId,
                  id: { in: missingSubscriberTokenIds },
                },
                select: {
                  id: true,
                  status: true,
                  requeuedToToken: {
                    select: {
                      publicId: true,
                      tokenNumber: true,
                    },
                  },
                  branch: {
                    select: {
                      slug: true,
                      organization: {
                        select: {
                          slug: true,
                        },
                      },
                    },
                  },
                },
              });

              for (const tok of fetched) {
                terminalTokensMap.set(tok.id, {
                  status: tok.status,
                  requeuedTo: tok.requeuedToToken
                    ? {
                        publicId: tok.requeuedToToken.publicId,
                        tokenNumber: tok.requeuedToToken.tokenNumber,
                        url: `/salon/${tok.branch.organization.slug}/${tok.branch.slug}/token/${tok.requeuedToToken.publicId}`,
                      }
                    : null,
                });
              }
            }

            const subscribersToClose: CustomerSubscriber[] = [];

            for (const cust of customers.values()) {
              const active = activeTokensById.get(cust.tokenId);
              if (active) {
                const metrics = waitSimulation.byTokenId.get(active.id);
                const payload: CustomerTokenUpdateData = {
                  publicId: active.publicId,
                  tokenNumber: active.tokenNumber,
                  status: active.status,
                  queuePosition: metrics?.queuePosition ?? 1,
                  peopleAhead: metrics?.peopleAhead ?? 0,
                  estimatedWaitMinutes: metrics?.estimatedWaitMinutes ?? 0,
                  totalPriceInPaise: active.totalPriceInPaise,
                  totalDurationMinutes: active.totalDurationMinutes,
                  updatedAt: timestamp,
                  isTerminal: false,
                  requeuedTo: null,
                };
                const sseMessage = formatSseEvent({
                  event: "token_update",
                  id: version,
                  data: payload,
                });
                try {
                  cust.send(sseMessage);
                } catch {
                  // ignore
                }
              } else {
                const terminal = terminalTokensMap.get(cust.tokenId);
                const isTerminalStatus =
                  terminal?.status === "COMPLETED" ||
                  terminal?.status === "CANCELLED" ||
                  terminal?.status === "NO_SHOW" ||
                  terminal?.status === "SKIPPED";

                const payload: CustomerTokenUpdateData = {
                  publicId: cust.publicId,
                  tokenNumber: "",
                  status: terminal?.status ?? "COMPLETED",
                  queuePosition: 0,
                  peopleAhead: 0,
                  estimatedWaitMinutes: 0,
                  totalPriceInPaise: 0,
                  totalDurationMinutes: 0,
                  updatedAt: timestamp,
                  isTerminal: isTerminalStatus,
                  requeuedTo: terminal?.requeuedTo ?? null,
                };
                const sseMessage = formatSseEvent({
                  event: "token_update",
                  id: version,
                  data: payload,
                });
                try {
                  cust.send(sseMessage);
                } catch {
                  // ignore
                }

                if (isTerminalStatus) {
                  subscribersToClose.push(cust);
                }
              }
            }

            for (const closedCust of subscribersToClose) {
              try {
                closedCust.close();
              } catch {
                // ignore
              }
            }
          }
        },
        activeClient,
      );
    } catch (err) {
      logger.error(
        { err, organizationId, branchId },
        "Error in RealtimeHub.computeAndFanoutBranchSnapshot",
      );
    }
  }

  public async close(): Promise<void> {
    for (const timer of this.coalesceTimers.values()) {
      clearTimeout(timer);
    }
    this.coalesceTimers.clear();
    this.ownerSubscribers.clear();
    this.customerSubscribers.clear();
    this.localEmitter.removeAllListeners();
    this.defaultClient = undefined;

    if (this.pgClient) {
      try {
        await this.pgClient.end();
      } catch {
        // ignore
      }
      this.pgClient = null;
      this.isPgListening = false;
    }
  }
}

// Global singleton instance
const globalForRealtime = globalThis as unknown as {
  salonflowRealtimeHub?: RealtimeHub;
};

export function getRealtimeHub(): RealtimeHub {
  if (!globalForRealtime.salonflowRealtimeHub) {
    globalForRealtime.salonflowRealtimeHub = new RealtimeHub();
  }
  return globalForRealtime.salonflowRealtimeHub;
}

export function resetRealtimeHubForTesting(): void {
  if (globalForRealtime.salonflowRealtimeHub) {
    void globalForRealtime.salonflowRealtimeHub.close();
    delete globalForRealtime.salonflowRealtimeHub;
  }
}
