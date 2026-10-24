import knex, { Knex } from 'knex';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { KnexInbox } from './knex-inbox';
import { createMigrationSource } from './migration-source';

const POSTGRES_IMAGE = 'postgres:18-alpine';
const CONTAINER_STARTUP_MS = 60_000;

describe('KnexInbox', () => {
  let container: StartedPostgreSqlContainer;
  let db: Knex;
  let inbox: KnexInbox;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    db = knex({ client: 'pg', connection: container.getConnectionUri() });
    await db.migrate.latest({ migrationSource: createMigrationSource() });
    inbox = new KnexInbox(db);
  }, CONTAINER_STARTUP_MS);

  afterEach(async () => {
    await db('processed_events').truncate();
  });

  afterAll(async () => {
    await db?.destroy();
    await container?.stop();
  });

  it('has processed an event once it is marked, and only that one', async () => {
    await expect(inbox.hasProcessed('evt-1')).resolves.toBe(false);

    await inbox.markProcessed('evt-1', 'marketplace.order.received.v1');

    await expect(inbox.hasProcessed('evt-1')).resolves.toBe(true);
    await expect(inbox.hasProcessed('evt-2')).resolves.toBe(false);
    expect(await db('processed_events').select('event_id', 'event_type')).toEqual([
      { event_id: 'evt-1', event_type: 'marketplace.order.received.v1' },
    ]);
  });

  it('accepts the same event marked twice, keeping one row', async () => {
    await inbox.markProcessed('evt-1', 'marketplace.order.received.v1');

    await expect(inbox.markProcessed('evt-1', 'marketplace.order.received.v1')).resolves.toBeUndefined();

    expect(await db('processed_events').count({ total: '*' }).first()).toEqual({ total: '1' });
  });
});
