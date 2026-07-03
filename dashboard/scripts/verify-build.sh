#!/bin/sh
# Verifies the production build artifacts in dist/:
#   - static single-page output (exactly one HTML entry point)
#   - runtime-editable config.js template (replaced at deploy time)
#   - zero MSW worker traces in the compiled bundle
# Run against an existing dist/ (e.g. via `pnpm verify:build`).
set -eu

cd "$(dirname "$0")/.."

fail() {
  echo "verify-build: FAIL — $1" >&2
  exit 1
}

[ -d dist ] || fail "dist/ does not exist — run 'vite build' first"

[ -f dist/index.html ] || fail "dist/index.html is missing"
echo "verify-build: ok — dist/index.html exists"

[ -f dist/config.js ] || fail "dist/config.js is missing"
echo "verify-build: ok — dist/config.js exists"

grep -q '__MYAMPMIX_CONFIG__' dist/config.js ||
  fail "dist/config.js is not the runtime config template (no __MYAMPMIX_CONFIG__)"
echo "verify-build: ok — dist/config.js is the runtime-editable __MYAMPMIX_CONFIG__ template"

grep -q '<script src="/config.js"></script>' dist/index.html ||
  fail "dist/index.html does not load /config.js before the app bundle"
echo "verify-build: ok — dist/index.html references /config.js"

html_count="$(find dist -name '*.html' | wc -l | tr -d ' ')"
[ "$html_count" = "1" ] ||
  fail "expected exactly one HTML entry point (SPA), found $html_count"
echo "verify-build: ok — exactly one HTML entry point (SPA)"

if grep -rq 'mockServiceWorker' dist/assets; then
  fail "MSW worker code leaked into the production bundle (dist/assets)"
fi
echo "verify-build: ok — no mockServiceWorker traces in dist/assets"

# The dev-only MSW worker lives in public/ (dev server + e2e only); the build
# scripts delete it from dist/ so the production artifact never ships it.
[ ! -f dist/mockServiceWorker.js ] ||
  fail "dist/mockServiceWorker.js must not ship in the production artifact"
echo "verify-build: ok — mockServiceWorker.js absent from dist/ root"

echo "verify-build: PASS — single-page dist, runtime config.js template, no MSW in bundle"
