#!/usr/bin/env bash
#
# Benchmark the redirect hot path (acceptance criteria §20.7: p95 < 100ms at
# 1000 concurrent connections against a warm cache).
#
# Usage:
#   scripts/bench-redirect.sh <code> [base_url] [duration] [concurrency]
#
# Example:
#   scripts/bench-redirect.sh abc123Z http://localhost:3000 20s 1000
#
# Prereqs: a link with <code> must already exist AND be a DIRECT (non-
# interstitial) link, otherwise you'll benchmark the 302→/p hop instead of the
# destination redirect. Warm the cache first by curling it once.
#
# We measure the 302 itself, so the load tool must NOT follow redirects.

set -euo pipefail

CODE="${1:?usage: bench-redirect.sh <code> [base_url] [duration] [concurrency]}"
BASE_URL="${2:-http://localhost:3000}"
DURATION="${3:-20s}"
CONCURRENCY="${4:-1000}"
URL="${BASE_URL}/r/${CODE}"

echo "Warming cache: ${URL}"
curl -s -o /dev/null -w "  first response: %{http_code} in %{time_total}s\n" "${URL}" || true
echo

if command -v oha >/dev/null 2>&1; then
  echo "→ oha (no redirect follow), c=${CONCURRENCY}, z=${DURATION}"
  exec oha --no-tui --disable-keepalive=false --redirect 0 -z "${DURATION}" -c "${CONCURRENCY}" "${URL}"
elif command -v bombardier >/dev/null 2>&1; then
  echo "→ bombardier, c=${CONCURRENCY}, duration=${DURATION}"
  exec bombardier -c "${CONCURRENCY}" -d "${DURATION}" -l --no-print-connection-errors "${URL}"
else
  echo "Neither 'oha' nor 'bombardier' is installed." >&2
  echo "Install one:" >&2
  echo "  brew install oha          # macOS" >&2
  echo "  go install github.com/codesenberg/bombardier@latest" >&2
  exit 1
fi
