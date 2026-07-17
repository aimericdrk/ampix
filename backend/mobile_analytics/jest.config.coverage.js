module.exports = {
  projects: ['<rootDir>/jest.config.js', '<rootDir>/test/jest-integration.config.js'],
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/**/*.module.ts', '!src/**/*.spec.ts'],
  coverageThreshold: { global: { lines: 85 } },
  // `testTimeout` is a root-only Jest option — it is silently dropped when set inside a
  // per-project config loaded via `projects` (verified via `--showConfig`: "Unknown option
  // testTimeout"), so the integration project's 300s Testcontainers timeout from
  // test/jest-integration.config.js never applies here without also setting it at the root.
  testTimeout: 300000,
};
