const crypto = require("node:crypto");
const {
  generateIndianName,
  generateIndianMobile,
  generateSyntheticIp,
  getRandomElement,
  getRandomInt,
  loadTenantsData,
} = require("./generate-synthetic-data");

let cachedTenants = null;
function getTenants() {
  if (!cachedTenants) {
    cachedTenants = loadTenantsData();
  }
  return cachedTenants;
}

// Track seen tokens across virtual users to detect duplicate token generation
const seenTokens = new Set();
let duplicateTokenCount = 0;

/**
 * Initializes synthetic customer variables before a customer scenario starts.
 */
function prepareCustomerScenario(userContext, events, done) {
  const tenants = getTenants();
  const selectedOrg = getRandomElement(tenants);
  const selectedBranch = getRandomElement(selectedOrg.branches);

  // Pick 1 or 2 services randomly
  const allServices = selectedBranch.services;
  const pickedServices = [];
  pickedServices.push(getRandomElement(allServices).id);
  if (allServices.length > 1 && Math.random() < 0.4) {
    const second = getRandomElement(allServices).id;
    if (!pickedServices.includes(second)) {
      pickedServices.push(second);
    }
  }

  userContext.vars.salonSlug = selectedOrg.orgSlug;
  userContext.vars.branchSlug = selectedBranch.slug;
  userContext.vars.branchId = selectedBranch.branchId;
  userContext.vars.orgName = selectedOrg.orgName;
  userContext.vars.branchName = selectedBranch.name;
  userContext.vars.clientIp = generateSyntheticIp();
  userContext.vars.fullName = generateIndianName();
  userContext.vars.mobileNumber = generateIndianMobile();
  userContext.vars.serviceIds = pickedServices;
  userContext.vars.idempotencyKey = crypto.randomUUID();
  userContext.vars.website = ""; // Empty string for honeypot
  userContext.vars.shouldCancel = Math.random() < 0.2; // 20% cancel rate

  return done();
}

/**
 * Initializes owner variables before an owner scenario starts.
 */
function prepareOwnerScenario(userContext, events, done) {
  const tenants = getTenants();
  const selectedOrg = getRandomElement(tenants);
  const selectedBranch = getRandomElement(selectedOrg.branches);

  userContext.vars.orgId = selectedOrg.orgId;
  userContext.vars.salonSlug = selectedOrg.orgSlug;
  userContext.vars.branchId = selectedBranch.branchId;
  userContext.vars.branchSlug = selectedBranch.slug;
  userContext.vars.branchName = selectedBranch.name;
  userContext.vars.ownerEmail = selectedOrg.ownerEmail;
  userContext.vars.ownerPassword = selectedOrg.ownerPassword;
  userContext.vars.ownerSessionToken = selectedOrg.ownerSessionToken;
  userContext.vars.clientIp = generateSyntheticIp();

  return done();
}

/**
 * Pre-request hook: injects client IP, CSRF origin header, and idempotency key.
 */
function setRequestHeaders(requestParams, userContext, ee, next) {
  requestParams.headers = requestParams.headers || {};
  if (userContext.vars.clientIp) {
    requestParams.headers["x-forwarded-for"] = userContext.vars.clientIp;
  }
  requestParams.headers["Origin"] = userContext.vars.target || "http://localhost:3000";
  return next();
}

/**
 * Post-response hook: checks for duplicate token numbers and extracts tracking data.
 */
function checkTokenResponse(requestParams, response, userContext, ee, next) {
  if (response.statusCode === 200 || response.statusCode === 201) {
    try {
      const data = typeof response.body === "string" ? JSON.parse(response.body) : response.body;
      if (data && data.token) {
        const tokenNumber = data.token.tokenNumber;
        const branchSlug = userContext.vars.branchSlug;
        const tokenKey = `${branchSlug}:${tokenNumber}`;

        if (seenTokens.has(tokenKey)) {
          duplicateTokenCount++;
          console.warn(`⚠️ [CONCURRENCY ALERT] Duplicate token number detected: ${tokenKey}! Total duplicates: ${duplicateTokenCount}`);
          ee.emit("counter", "custom.tokens.duplicate", 1);
        } else {
          seenTokens.add(tokenKey);
          ee.emit("counter", "custom.tokens.unique", 1);
        }

        userContext.vars.publicId = data.token.publicId;
        userContext.vars.tokenNumber = data.token.tokenNumber;
        userContext.vars.tokenId = data.token.id;
      }
    } catch {
      // Body not JSON or empty
    }
  }
  return next();
}

/**
 * Post-response hook: captures ETag for polling checks.
 */
function captureEtag(requestParams, response, userContext, ee, next) {
  if (response.headers && response.headers.etag) {
    userContext.vars.lastEtag = response.headers.etag;
  }
  return next();
}

module.exports = {
  prepareCustomerScenario,
  prepareOwnerScenario,
  setRequestHeaders,
  checkTokenResponse,
  captureEtag,
  duplicateTokenCount: () => duplicateTokenCount,
};

