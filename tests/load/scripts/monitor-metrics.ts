/**
 * System & Database Telemetry Monitor for SalonFlow Load Testing
 * Captures real-time PostgreSQL connection usage, active queries, lock contention,
 * and Node.js process resource utilization during test execution.
 */

import { Client } from "pg";

export interface MonitorOptions {
  intervalMs?: number;
}

export interface MetricSample {
  timestamp: string;
  postgres: {
    totalConnections: number;
    activeConnections: number;
    idleConnections: number;
    idleInTransaction: number;
    ungrantedLocks: number;
  };
  queue: {
    recentTokens: number;
    waiting: number;
    inService: number;
    completed: number;
  };
  processMemory: {
    rssMb: string;
    heapUsedMb: string;
  };
}

export interface TelemetrySummary {
  sampleCount: number;
  peakPostgresActiveConnections: number;
  peakPostgresTotalConnections: number;
  peakLockContentionWaiting: number;
  peakProcessHeapUsedMb: number;
  totalRecentTokensInDB: number;
}

export class PerformanceMonitor {
  private connectionString: string;
  private intervalMs: number;
  public samples: MetricSample[];
  private running: boolean;
  private client: Client | null;
  private timer: NodeJS.Timeout | null;

  constructor(options: MonitorOptions = {}) {
    this.connectionString =
      process.env.DIRECT_URL ||
      process.env.DATABASE_URL ||
      "postgresql://salonflow_admin:salonflow_admin_dev@localhost:5434/salonflow?schema=public";
    this.intervalMs = options.intervalMs || 1000;
    this.samples = [];
    this.running = false;
    this.client = null;
    this.timer = null;
  }

  async start(): Promise<void> {
    this.client = new Client({ connectionString: this.connectionString });
    await this.client.connect();
    this.running = true;
    console.log("📈 Database performance telemetry monitor started...");

    this.timer = setInterval(async () => {
      if (!this.running) return;
      try {
        const stats = await this.collectStats();
        this.samples.push(stats);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("Telemetry collection error:", msg);
      }
    }, this.intervalMs);
  }

  async collectStats(): Promise<MetricSample> {
    if (!this.client) {
      throw new Error("Client not connected");
    }
    const timestamp = new Date().toISOString();

    // 1. PostgreSQL active connections and states
    const connRes = await this.client.query(`
      SELECT 
        count(*) as total_connections,
        count(*) FILTER (WHERE state = 'active') as active_connections,
        count(*) FILTER (WHERE state = 'idle') as idle_connections,
        count(*) FILTER (WHERE state = 'idle in transaction') as idle_in_trans_connections
      FROM pg_stat_activity 
      WHERE datname = current_database();
    `);

    // 2. Lock contention / blocked queries
    const lockRes = await this.client.query(`
      SELECT count(*) as ungranted_locks 
      FROM pg_locks 
      WHERE NOT granted;
    `);

    // 3. Queue counters and token counts
    const countsRes = await this.client.query(`
      SELECT 
        (SELECT count(*) FROM tokens WHERE created_at > now() - interval '5 minutes') as recent_tokens,
        (SELECT count(*) FROM tokens WHERE status = 'WAITING') as waiting_tokens,
        (SELECT count(*) FROM tokens WHERE status = 'IN_SERVICE') as in_service_tokens,
        (SELECT count(*) FROM tokens WHERE status = 'COMPLETED') as completed_tokens
    `);

    // 4. Memory metrics
    const mem = process.memoryUsage();

    const row = connRes.rows[0] as {
      total_connections?: string;
      active_connections?: string;
      idle_connections?: string;
      idle_in_trans_connections?: string;
    };
    const lockRow = lockRes.rows[0] as { ungranted_locks?: string };
    const countsRow = countsRes.rows[0] as {
      recent_tokens?: string;
      waiting?: string;
      in_service?: string;
      completed?: string;
    };

    return {
      timestamp,
      postgres: {
        totalConnections: parseInt(row?.total_connections || "0", 10),
        activeConnections: parseInt(row?.active_connections || "0", 10),
        idleConnections: parseInt(row?.idle_connections || "0", 10),
        idleInTransaction: parseInt(row?.idle_in_trans_connections || "0", 10),
        ungrantedLocks: parseInt(lockRow?.ungranted_locks || "0", 10),
      },
      queue: {
        recentTokens: parseInt(countsRow?.recent_tokens || "0", 10),
        waiting: parseInt(countsRow?.waiting || "0", 10),
        inService: parseInt(countsRow?.in_service || "0", 10),
        completed: parseInt(countsRow?.completed || "0", 10),
      },
      processMemory: {
        rssMb: (mem.rss / 1024 / 1024).toFixed(1),
        heapUsedMb: (mem.heapUsed / 1024 / 1024).toFixed(1),
      },
    };
  }

  async stop(): Promise<TelemetrySummary | null> {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.client) {
      await this.client.end();
      this.client = null;
    }
    console.log(`📉 Monitor stopped. Captured ${this.samples.length} telemetry samples.`);
    return this.generateSummary();
  }

  generateSummary(): TelemetrySummary | null {
    if (this.samples.length === 0) return null;

    const maxActiveConn = Math.max(...this.samples.map((s) => s.postgres.activeConnections));
    const maxTotalConn = Math.max(...this.samples.map((s) => s.postgres.totalConnections));
    const maxLocks = Math.max(...this.samples.map((s) => s.postgres.ungrantedLocks));
    const maxHeapMb = Math.max(...this.samples.map((s) => parseFloat(s.processMemory.heapUsedMb)));
    const totalTokensCreated = this.samples[this.samples.length - 1]?.queue.recentTokens || 0;

    const summary: TelemetrySummary = {
      sampleCount: this.samples.length,
      peakPostgresActiveConnections: maxActiveConn,
      peakPostgresTotalConnections: maxTotalConn,
      peakLockContentionWaiting: maxLocks,
      peakProcessHeapUsedMb: maxHeapMb,
      totalRecentTokensInDB: totalTokensCreated,
    };

    console.log("📊 Telemetry Summary:", JSON.stringify(summary, null, 2));
    return summary;
  }
}

if (typeof require !== "undefined" && require.main === module) {
  const durationSec = parseInt(process.argv[2] || "30", 10);
  const monitor = new PerformanceMonitor();
  monitor.start().then(() => {
    setTimeout(async () => {
      await monitor.stop();
      process.exit(0);
    }, durationSec * 1000);
  }).catch((err: unknown) => {
    console.error("Monitor failed:", err);
    process.exit(1);
  });
}
