import { Knex } from 'knex';
import { createTestDatabase, TestDatabase } from '../testing/test-database';
import { KnexInboxRepository } from './knex-inbox.repository';
import { createMigrationSource } from './migration-source';

describe('KnexInboxRepository', () => {
  let testDatabase: TestDatabase;
  let db: Knex;
  let inbox: KnexInboxRepository;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    db = testDatabase.db;
    await db.migrate.latest({ migrationSource: createMigrationSource() });
    inbox = new KnexInboxRepository(db);
  });

  afterEach(async () => {
    await db('processed_events').truncate();
  });

  afterAll(async () => {
    await testDatabase?.destroy();
  });

  it('has not processed an event it never saw', async () => {
    await expect(inbox.hasProcessed('evt-1')).resolves.toBe(false);
  });

  it('has processed an event once it is marked, and only that one', async () => {
    await inbox.markProcessed('evt-1', 'order.order.cancelled.v1');

    await expect(inbox.hasProcessed('evt-1')).resolves.toBe(true);
    await expect(inbox.hasProcessed('evt-2')).resolves.toBe(false);
    expect(await db('processed_events').select('event_id', 'event_type')).toEqual([
      { event_id: 'evt-1', event_type: 'order.order.cancelled.v1' },
    ]);
  });

  it('accepts the same event marked twice, keeping one row', async () => {
    await inbox.markProcessed('evt-1', 'order.order.cancelled.v1');

    await expect(inbox.markProcessed('evt-1', 'order.order.cancelled.v1')).resolves.toBeUndefined();

    expect(await db('processed_events').count({ total: '*' }).first()).toEqual({ total: '1' });
  });
});
