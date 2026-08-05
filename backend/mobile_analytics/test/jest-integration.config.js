module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '..',
  testMatch: ['<rootDir>/test/integration/**/*.int-spec.ts'],
  moduleNameMapper: {
    '^@myampix/contracts$': '<rootDir>/../../packages/contracts/src',
  },
  testTimeout: 300000,
};
