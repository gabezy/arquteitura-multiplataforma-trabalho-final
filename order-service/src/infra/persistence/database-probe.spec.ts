import knex, { Knex } from 'knex';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDatabaseProbe } from './database-probe';

const POSTGRES_IMAGE = 'postgres:18-alpine';
const CONTAINER_STARTUP_MS = 60_000;

describe('createDatabaseProbe', () => {
  let container: StartedPostgreSqlContainer;
  let db: Knex;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    db = knex({ client: 'pg', connection: container.getConnectionUri() });
  }, CONTAINER_STARTUP_MS);

  afterAll(async () => {
    await db?.destroy();
    await container?.stop();
  });

  it('resolves when the database answers select 1', async () => {
    await expect(createDatabaseProbe(db)()).resolves.toBeUndefined();
  });

  it('rejects when the database is unreachable', async () => {
    const unreachable = knex({ client: 'pg', connection: 'postgresql://orders:orders@127.0.0.1:1/orders' });

    await expect(createDatabaseProbe(unreachable)()).rejects.toThrow('ECONNREFUSED');
    await unreachable.destroy();
  });

  describe('with a database that never answers', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    const hungDatabase = { raw: () => new Promise(() => {}) } as unknown as Knex;

    it('rejects once 2 s have passed', async () => {
      const outcome = createDatabaseProbe(hungDatabase)().then(
        () => 'resolved',
        (err: Error) => err.message,
      );

      await jest.advanceTimersByTimeAsync(1_999);
      await jest.advanceTimersByTimeAsync(1);

      await expect(outcome).resolves.toBe('Database did not answer within 2000 ms');
    });

    it('is still pending just before 2 s', async () => {
      let settled = false;
      createDatabaseProbe(hungDatabase)().then(
        () => (settled = true),
        () => (settled = true),
      );

      await jest.advanceTimersByTimeAsync(1_999);

      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
    });
  });
});
