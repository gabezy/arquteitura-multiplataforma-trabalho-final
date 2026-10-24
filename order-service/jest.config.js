/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  // Several suites start a Postgres container, and stopping them together can take longer than the 5 s default.
  testTimeout: 30_000,
  roots: ['<rootDir>/src'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts', '!src/main.ts', '!src/infra/observability/instrumentation.ts'],
};
