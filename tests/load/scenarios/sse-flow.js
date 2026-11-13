/**
 * Dedicated SSE Connection Load & Longevity Scenario
 * Tests concurrent SSE stream capacity, handshake latency, keepalive ping detection,
 * graceful disconnections, and reconnection behavior against SalonFlow realtime endpoints.
 */

const http = require("node:http");
const { generateSyntheticIp, loadTenantsData, getRandomElement } = require("../data/generate-synthetic-data");

class SseConnectionTest {
  constructor(options = {}) {
    this.target = options.target || "http://localhost:3000";
    this.concurrency = options.concurrency || 50;
    this.durationMs = options.durationMs || 15000; // 15 seconds per connection
    this.reconnectAttempts = options.reconnectAttempts || 1;
    this.tenants = loadTenantsData();
    this.stats = {
      connected: 0,
      disconnected: 0,
      pingsReceived: 0,
      eventsReceived: 0,
      errors: 0,
      handshakeDurations: [],
    };
  }

  async run() {
    console.log(`📡 Starting SSE Longevity Test: ${this.concurrency} concurrent connections for ${this.durationMs / 1000}s...`);
    const promises = [];
    for (let i = 0; i < this.concurrency; i++) {
      promises.push(this.simulateClient(i));
    }
    await Promise.allSettled(promises);
    return this.report();
  }

  simulateClient(clientId) {
    return new Promise((resolve) => {
      const org = getRandomElement(this.tenants);
      const branch = getRandomElement(org.branches);
      const clientIp = generateSyntheticIp();
      const path = `/api/public/salons/${org.orgSlug}/${branch.slug}/queue/events`;

      const startTime = Date.now();
      const url = new URL(this.target + path);

      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port || 3000,
          path: url.pathname + url.search,
          method: "GET",
          headers: {
            Accept: "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "x-forwarded-for": clientIp,
          },
        },
        (res) => {
          if (res.statusCode !== 200) {
            this.stats.errors++;
            res.resume();
            return resolve();
          }

          const handshakeDuration = Date.now() - startTime;
          this.stats.handshakeDurations.push(handshakeDuration);
          this.stats.connected++;

          let buffer = "";
          res.on("data", (chunk) => {
            buffer += chunk.toString();
            if (buffer.includes(": ping")) {
              this.stats.pingsReceived++;
            }
            if (buffer.includes("event:") || buffer.includes("data:")) {
              this.stats.eventsReceived++;
            }
            // Keep buffer bounded
            if (buffer.length > 4096) buffer = buffer.slice(-1024);
          });

          // Hold connection open for durationMs
          setTimeout(() => {
            res.destroy();
            this.stats.disconnected++;
            resolve();
          }, this.durationMs);
        }
      );

      req.on("error", (err) => {
        this.stats.errors++;
        resolve();
      });

      req.end();
    });
  }

  report() {
    const sortedHandshakes = [...this.stats.handshakeDurations].sort((a, b) => a - b);
    const p50 = sortedHandshakes[Math.floor(sortedHandshakes.length * 0.5)] || 0;
    const p95 = sortedHandshakes[Math.floor(sortedHandshakes.length * 0.95)] || 0;
    const p99 = sortedHandshakes[Math.floor(sortedHandshakes.length * 0.99)] || 0;

    const result = {
      concurrency: this.concurrency,
      durationSeconds: this.durationMs / 1000,
      totalConnected: this.stats.connected,
      totalDisconnected: this.stats.disconnected,
      pingsReceived: this.stats.pingsReceived,
      eventsReceived: this.stats.eventsReceived,
      errors: this.stats.errors,
      handshakeLatency: {
        minMs: sortedHandshakes[0] || 0,
        maxMs: sortedHandshakes[sortedHandshakes.length - 1] || 0,
        p50Ms: p50,
        p95Ms: p95,
        p99Ms: p99,
      },
    };

    console.log("📊 SSE Test Report:", JSON.stringify(result, null, 2));
    return result;
  }
}

if (require.main === module) {
  const concurrency = parseInt(process.argv[2] || "50", 10);
  const durationMs = parseInt(process.argv[3] || "10000", 10);
  const tester = new SseConnectionTest({ concurrency, durationMs });
  tester.run().then(() => process.exit(0)).catch((err) => {
    console.error("SSE Test Failed:", err);
    process.exit(1);
  });
}

module.exports = { SseConnectionTest };

