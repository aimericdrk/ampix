module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '..',
  testMatch: ['<rootDir>/test/e2e/**/*.e2e-spec.ts'],
  moduleNameMapper: {
    '^@myampix/contracts$': '<rootDir>/../packages/contracts/src',
  },
  testTimeout: 300000,
};
