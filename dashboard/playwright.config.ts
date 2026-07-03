import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm dev',
    env: { VITE_ENABLE_MSW: 'true' },
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
});
