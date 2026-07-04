import { defineConfig, devices } from '@playwright/test';

/**
 * Functional end-to-end config: drives the real dashboard against the REAL backend
 * (docker-composed ClickHouse/Postgres/Redis + `node dist/main.js`) — no mocks.
 *
 * Deliberately a SEPARATE config from playwright.config.ts (the MSW-backed smoke
 * suite, which must keep working unmodified). The critical difference is the
 * webServer below: it does NOT set VITE_ENABLE_MSW, so dashboard/src/main.tsx's
 * `import.meta.env.DEV && VITE_ENABLE_MSW === 'true'` gate stays false, the MSW
 * worker never starts, and every /api + /ingest request proxies (see
 * dashboard/vite.config.ts) straight through to the real backend on :8080.
 *
 * Not meant to be run standalone against a cold environment — use
 * `pnpm test:functional` (scripts/functional-test.sh), which brings up infra and
 * the backend first, then invokes this config.
 */
export default defineConfig({
  testDir: './e2e-functional',
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    // No VITE_ENABLE_MSW here — contrast with playwright.config.ts. This dev
    // server must talk to the real backend, never the mock worker.
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
