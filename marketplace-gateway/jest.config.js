const common = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
};

/** @type {import('jest').Config} */
module.exports = {
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/**/testing/**',
    '!src/main.ts',
    '!src/infra/observability/instrumentation.ts',
  ],
  projects: [
    // Specs that need no container: fakes, supertest, fake timers.
    {
      ...common,
      displayName: 'unit',
      testMatch: ['<rootDir>/src/**/*.spec.ts'],
      testPathIgnorePatterns: ['/node_modules/', '\\.int\\.spec\\.ts$'],
    },
    // Specs that need Docker. The global setup runs only when one of them is selected, and it
    // starts one Postgres for all of them (see src/infra/testing/global-setup.ts).
    {
      ...common,
      displayName: 'integration',
      testMatch: ['<rootDir>/src/**/*.int.spec.ts'],
      testTimeout: 60_000,
      globalSetup: '<rootDir>/src/infra/testing/global-setup.ts',
      globalTeardown: '<rootDir>/src/infra/testing/global-teardown.ts',
    },
  ],
};
