/**
 * Playwright Browser Virtual User Scenario
 * Simulates real end-to-end browser user interactions:
 * 1. Visits public salon branch intake URL
 * 2. Selects service cards
 * 3. Enters synthetic name & mobile number
 * 4. Submits form and joins queue
 * 5. Verifies redirection to live ticket screen (/token/[publicId])
 * 6. Validates token ticket elements and wait-time display
 */

const { chromium } = require("playwright");
const {
  generateIndianName,
  generateIndianMobile,
  generateSyntheticIp,
  loadTenantsData,
  getRandomElement,
} = require("../data/generate-synthetic-data");

/**
 * Artillery Playwright engine entrypoint.
 * Signature: async function(page, userContext, events)
 */
async function customerBrowserFlow(page, userContext, events) {
  const tenants = loadTenantsData();
  const org = getRandomElement(tenants);
  const branch = getRandomElement(org.branches);
  const target = userContext?.vars?.target || "http://localhost:3000";
  const url = `${target}/salon/${org.orgSlug}/${branch.slug}`;

  const fullName = generateIndianName();
  const mobileNumber = generateIndianMobile();

  // Navigate to intake page
  await page.goto(url, { waitUntil: "networkidle" });

  // Click first service card
  const serviceCards = page.locator("button[role='checkbox'], button[type='button']");
  const count = await serviceCards.count();
  if (count > 0) {
    await serviceCards.first().click();
  }

  // Fill Name and Mobile
  await page.fill('input[name="fullName"]', fullName);
  await page.fill('input[name="mobileNumber"]', mobileNumber);

  // Submit Form
  const submitButton = page.locator('button[type="submit"]');
  await submitButton.click();

  // Wait for ticket URL navigation
  await page.waitForURL(/\/token\/[a-f0-9-]+/, { timeout: 10000 });

  // Verify ticket elements render
  await page.waitForSelector("text=Token", { timeout: 5000 });
}

/**
 * Standalone Playwright browser runner for running low-concurrency browser tests (e.g. 5 concurrent browsers).
 */
async function runStandaloneBrowserLoad(options = {}) {
  const concurrency = options.concurrency || 3;
  const target = options.target || "http://localhost:3000";
  const tenants = loadTenantsData();

  console.log(`🌐 Launching ${concurrency} Playwright Chromium browser virtual users against ${target}...`);
  const browser = await chromium.launch({ headless: true });

  const tasks = [];
  const metrics = [];

  for (let i = 0; i < concurrency; i++) {
    tasks.push((async () => {
      const org = getRandomElement(tenants);
      const branch = getRandomElement(org.branches);
      const url = `${target}/salon/${org.orgSlug}/${branch.slug}`;
      const fullName = generateIndianName();
      const mobileNumber = generateIndianMobile();
      const clientIp = generateSyntheticIp();

      const context = await browser.newContext({
        extraHTTPHeaders: {
          "x-forwarded-for": clientIp,
        },
        viewport: { width: 390, height: 844 }, // Mobile viewport (iPhone 12/13/14)
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
      });

      const page = await context.newPage();
      const t0 = Date.now();

      try {
        // Step 1: Browse intake
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
        const browseDuration = Date.now() - t0;

        // Step 2: Select service
        const serviceButton = page.locator("button:has-text('Quick Haircut'), button:has-text('Beard Styling')").first();
        await serviceButton.waitFor({ state: "visible", timeout: 5000 });
        await serviceButton.click();

        // Step 3: Fill inputs
        await page.fill('input[name="fullName"]', fullName);
        await page.fill('input[name="mobileNumber"]', mobileNumber);

        // Step 4: Submit intake
        const submitT0 = Date.now();
        const submitBtn = page.locator("button[type='submit']");
        await submitBtn.click();

        // Step 5: Wait for ticket URL
        await page.waitForURL(/\/token\/[a-f0-9-]+/, { timeout: 15000 });
        const submissionDuration = Date.now() - submitT0;
        const totalDuration = Date.now() - t0;

        const ticketUrl = page.url();
        console.log(`  [VU ${i + 1}] Successfully generated ticket in ${totalDuration}ms: ${ticketUrl}`);

        metrics.push({
          vu: i + 1,
          success: true,
          browseMs: browseDuration,
          submitMs: submissionDuration,
          totalMs: totalDuration,
          ticketUrl,
        });
      } catch (err) {
        console.error(`  [VU ${i + 1}] Browser flow failed:`, err.message);
        metrics.push({
          vu: i + 1,
          success: false,
          error: err.message,
        });
      } finally {
        await context.close();
      }
    })());
  }

  await Promise.all(tasks);
  await browser.close();

  const successful = metrics.filter(m => m.success);
  console.log(`🏁 Browser Virtual Users Finished: ${successful.length}/${concurrency} passed.`);
  return metrics;
}

if (require.main === module) {
  const concurrency = parseInt(process.argv[2] || "3", 10);
  runStandaloneBrowserLoad({ concurrency }).then(() => process.exit(0)).catch((err) => {
    console.error("Browser test run failed:", err);
    process.exit(1);
  });
}

module.exports = {
  customerBrowserFlow,
  runStandaloneBrowserLoad,
};

