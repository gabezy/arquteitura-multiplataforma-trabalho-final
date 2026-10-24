import { createDatabaseProbe } from './database-probe';
import { createTestDatabase, TestDatabase } from '../testing/test-database';

describe('createDatabaseProbe against Postgres', () => {
  let testDatabase: TestDatabase;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
  });

  afterAll(async () => {
    await testDatabase?.destroy();
  });

  it('resolves when Postgres answers select 1', async () => {
    await expect(createDatabaseProbe(testDatabase.db)()).resolves.toBeUndefined();
  });
});
