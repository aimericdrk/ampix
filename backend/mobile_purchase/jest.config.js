module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/test/e2e/**/*.e2e-spec.ts'],
  // Disable the @nestjs/schedule cron in tests (see test/jest-setup-env.ts) so a background sweep
  // never fires mid-run and races Testcontainers teardown.
  setupFiles: ['<rootDir>/test/jest-setup-env.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/**/*.module.ts', '!src/**/*.spec.ts'],
};
