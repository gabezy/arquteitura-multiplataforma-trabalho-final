import { Knex } from 'knex';
import { createTestDatabase, TestDatabase } from '../testing/test-database';
import { KnexOrderCursorRepository } from './knex-order-cursor.repository';
import { createMigrationSource } from './migration-source';

describe('KnexOrderCursorRepository', () => {
  let testDatabase: TestDatabase;
  let db: Knex;
  let cursors: KnexOrderCursorRepository;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    db = testDatabase.db;
    await db.migrate.latest({ migrationSource: createMigrationSource() });
    cursors = new KnexOrderCursorRepository(db);
  });

  afterEach(async () => {
    await db('order_cursors').truncate();
  });

  afterAll(async () => {
    await testDatabase?.destroy();
  });

  it('has no cursor for a marketplace that was never polled', async () => {
    await expect(cursors.find('AMAZON')).resolves.toBeNull();
  });

  it('gives back the instant that was saved, to the millisecond', async () => {
    const startedAt = new Date('2026-10-28T13:05:00.123Z');

    await cursors.save('AMAZON', startedAt);

    await expect(cursors.find('AMAZON')).resolves.toEqual(startedAt);
  });

  it('moves the cursor of a marketplace on a new save, keeping one row for it', async () => {
    await cursors.save('AMAZON', new Date('2026-10-28T13:05:00.000Z'));

    await cursors.save('AMAZON', new Date('2026-10-28T13:05:05.000Z'));

    await expect(cursors.find('AMAZON')).resolves.toEqual(new Date('2026-10-28T13:05:05.000Z'));
    expect(await db('order_cursors').count({ total: '*' }).first()).toEqual({ total: '1' });
  });

  it('keeps one cursor per marketplace', async () => {
    await cursors.save('AMAZON', new Date('2026-10-28T13:05:00.000Z'));
    await cursors.save('SHOPEE', new Date('2026-10-28T13:07:00.000Z'));

    await expect(cursors.find('AMAZON')).resolves.toEqual(new Date('2026-10-28T13:05:00.000Z'));
    await expect(cursors.find('SHOPEE')).resolves.toEqual(new Date('2026-10-28T13:07:00.000Z'));
    await expect(cursors.find('MERCADO_LIVRE')).resolves.toBeNull();
  });
});
