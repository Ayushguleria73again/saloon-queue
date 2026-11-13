#!/usr/bin/env bash
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
REPORTS_DIR="${ROOT_DIR}/tests/load/reports"
PROFILES_DIR="${ROOT_DIR}/tests/load/profiles"

mkdir -p "${REPORTS_DIR}"

TARGET_URL="${TARGET_URL:-http://localhost:3000}"
PROFILE_TO_RUN="${1:-smoke}"

echo "=========================================================="
echo "🎯 SALONFLOW HYBRID LOAD TESTING SUITE"
echo "Target URL:   ${TARGET_URL}"
echo "Profile:      ${PROFILE_TO_RUN}"
echo "Reports Dir:  ${REPORTS_DIR}"
echo "=========================================================="

# Safety verification: ensure server is reachable
echo "🔍 Checking target server health at ${TARGET_URL}/api/health or ${TARGET_URL}..."
if ! curl -sf "${TARGET_URL}/api/health" > /dev/null 2>&1 && ! curl -sf "${TARGET_URL}" > /dev/null 2>&1; then
  echo "⚠️ Target server at ${TARGET_URL} is not responding. Please ensure SalonFlow is running!"
  echo "   (e.g., OUTBOX_WORKER_ENABLED=false npm run dev  OR  npm run start)"
  exit 1
fi
echo "✅ Target server is online and responding."

# 1. Seed load test tenant data
echo ""
echo "🌱 Seeding load test tenant metadata and isolated organizations..."
node -r dotenv/config "${ROOT_DIR}/node_modules/.bin/vite-node" "${ROOT_DIR}/tests/load/scripts/seed-load-data.ts"
echo "✅ Seeding verified."

run_profile() {
  local name="$1"
  local file="${PROFILES_DIR}/${name}.yml"
  local json_out="${REPORTS_DIR}/${name}-report.json"
  local html_out="${REPORTS_DIR}/${name}-report.html"

  if [ ! -f "${file}" ]; then
    echo "❌ Profile not found: ${file}"
    return 1
  fi

  echo ""
  echo "----------------------------------------------------------"
  echo "🚀 Running Profile: ${name}"
  echo "Config: ${file}"
  echo "----------------------------------------------------------"

  node "${ROOT_DIR}/node_modules/artillery/bin/run" run \
    --output "${json_out}" \
    "${file}"

  echo "📄 Generating HTML report..."
  node "${ROOT_DIR}/node_modules/artillery/bin/run" report \
    --output "${html_out}" \
    "${json_out}" || true

  echo "✅ Finished ${name}. Report saved to ${html_out}"
}

case "${PROFILE_TO_RUN}" in
  smoke)
    run_profile "01-smoke"
    ;;
  baseline)
    run_profile "02-baseline"
    ;;
  load)
    run_profile "03-load"
    ;;
  stress)
    run_profile "04-stress"
    ;;
  capacity)
    run_profile "05-capacity"
    ;;
  spike)
    run_profile "06-spike"
    ;;
  soak)
    run_profile "07-soak"
    ;;
  browser)
    echo "🌐 Executing Playwright Browser Load Test..."
    node "${ROOT_DIR}/tests/load/scenarios/browser-flow.js" 3
    ;;
  sse)
    echo "📡 Executing Dedicated SSE Stream Longevity Test..."
    node "${ROOT_DIR}/tests/load/scenarios/sse-flow.js" 50 10000
    ;;
  all)
    echo "⚡ Executing Full Benchmark Suite: Smoke -> Baseline -> Load -> Stress -> Capacity -> Spike -> Soak -> Browser -> SSE"
    run_profile "01-smoke"
    run_profile "02-baseline"
    run_profile "03-load"
    run_profile "04-stress"
    run_profile "05-capacity"
    run_profile "06-spike"
    run_profile "07-soak"
    echo "🌐 Executing Playwright Browser Load Test..."
    node "${ROOT_DIR}/tests/load/scenarios/browser-flow.js" 3
    echo "📡 Executing Dedicated SSE Stream Longevity Test..."
    node "${ROOT_DIR}/tests/load/scenarios/sse-flow.js" 50 10000
    ;;
  *)
    echo "Unknown profile '${PROFILE_TO_RUN}'. Available: smoke, baseline, load, stress, capacity, spike, soak, browser, sse, all"
    exit 1
    ;;
esac

echo ""
echo "=========================================================="
echo "🎉 Load Testing Execution Completed Successfully!"
echo "Reports directory: ${REPORTS_DIR}"
echo "=========================================================="

