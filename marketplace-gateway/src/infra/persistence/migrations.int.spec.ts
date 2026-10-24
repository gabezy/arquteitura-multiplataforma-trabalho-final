import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { Knex } from 'knex';
import pino, { Logger } from 'pino';
import { runMigrations } from './migrator';
import { createTestDatabase, TestDatabase } from '../testing/test-database';

const SERVICE_DIR = path.join(__dirname, '..', '..', '..');

interface LogLine {
  level: number;
  msg: string;
}

const capturingLogger = (): { logger: Logger; lines: LogLine[] } => {
  const lines: LogLine[] = [];
  const logger = pino({ level: 'info' }, { write: (line: string) => lines.push(JSON.parse(line)) });
  return { logger, lines };
};

const columnsOf = async (db: Knex, table: string) =>
  db('information_schema.columns')
    .where({ table_schema: 'public', table_name: table })
    .orderBy('ordinal_position')
    .select('column_name', 'data_type', 'is_nullable', 'column_default');

describe('migrations', () => {
  let testDatabase: TestDatabase;
  let db: Knex;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    db = testDatabase.db;
  });

  afterAll(async () => {
    await testDatabase?.destroy();
  });

  it('creates the tables of the service, then applies nothing on a second run', async () => {
    const first = capturingLogger();
    expect(await runMigrations(db, first.logger)).toBe(true);
    expect(first.lines.map(line => line.msg)).toEqual(['Applied 6 migration(s)']);

    expect(await columnsOf(db, 'outbox')).toEqual([
      { column_name: 'sequence', data_type: 'bigint', is_nullable: 'NO', column_default: expect.stringContaining('nextval') },
      { column_name: 'event_id', data_type: 'uuid', is_nullable: 'NO', column_default: null },
      { column_name: 'aggregate_type', data_type: 'character varying', is_nullable: 'NO', column_default: null },
      { column_name: 'aggregate_id', data_type: 'text', is_nullable: 'NO', column_default: null },
      { column_name: 'event_type', data_type: 'character varying', is_nullable: 'NO', column_default: null },
      { column_name: 'payload', data_type: 'jsonb', is_nullable: 'NO', column_default: null },
      { column_name: 'headers', data_type: 'jsonb', is_nullable: 'YES', column_default: null },
      { column_name: 'occurred_at', data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: null },
      { column_name: 'published_at', data_type: 'timestamp with time zone', is_nullable: 'YES', column_default: null },
    ]);
    expect(await columnsOf(db, 'processed_events')).toEqual([
      { column_name: 'event_id', data_type: 'text', is_nullable: 'NO', column_default: null },
      { column_name: 'event_type', data_type: 'text', is_nullable: 'NO', column_default: null },
      { column_name: 'processed_at', data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: 'now()' },
    ]);
    const primaryKey = await db.raw(
      `select a.attname from pg_index i
         join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
        where i.indrelid = 'processed_events'::regclass and i.indisprimary`,
    );
    expect(primaryKey.rows).toEqual([{ attname: 'event_id' }]);

    expect(await columnsOf(db, 'marketplace_orders')).toEqual([
      { column_name: 'marketplace', data_type: 'text', is_nullable: 'NO', column_default: null },
      { column_name: 'external_order_id', data_type: 'text', is_nullable: 'NO', column_default: null },
      { column_name: 'items', data_type: 'jsonb', is_nullable: 'NO', column_default: null },
      { column_name: 'total', data_type: 'numeric', is_nullable: 'NO', column_default: null },
      { column_name: 'ordered_at', data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: null },
      { column_name: 'received_at', data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: 'now()' },
    ]);
    const orderKey = await db.raw(
      `select a.attname from pg_index i
         join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
        where i.indrelid = 'marketplace_orders'::regclass and i.indisprimary`,
    );
    expect(orderKey.rows.map((row: { attname: string }) => row.attname).sort()).toEqual(['external_order_id', 'marketplace']);
    expect(await columnsOf(db, 'order_cursors')).toEqual([
      { column_name: 'marketplace', data_type: 'text', is_nullable: 'NO', column_default: null },
      { column_name: 'last_polled_at', data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: null },
    ]);

    expect(await columnsOf(db, 'listings')).toEqual([
      { column_name: 'id', data_type: 'uuid', is_nullable: 'NO', column_default: null },
      { column_name: 'product_id', data_type: 'uuid', is_nullable: 'NO', column_default: null },
      { column_name: 'sku', data_type: 'text', is_nullable: 'NO', column_default: null },
      { column_name: 'marketplace', data_type: 'text', is_nullable: 'NO', column_default: null },
      { column_name: 'status', data_type: 'text', is_nullable: 'NO', column_default: null },
      { column_name: 'external_listing_id', data_type: 'text', is_nullable: 'YES', column_default: null },
      { column_name: 'price', data_type: 'numeric', is_nullable: 'NO', column_default: null },
      { column_name: 'stock', data_type: 'integer', is_nullable: 'NO', column_default: null },
      { column_name: 'failure_reason', data_type: 'text', is_nullable: 'YES', column_default: null },
      { column_name: 'attempts', data_type: 'integer', is_nullable: 'NO', column_default: '0' },
      { column_name: 'created_at', data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: 'now()' },
      { column_name: 'updated_at', data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: null },
      { column_name: 'stock_synced', data_type: 'boolean', is_nullable: 'NO', column_default: 'true' },
    ]);
    const listingUniqueness = await db.raw(
      `select a.attname from pg_index i
         join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
        where i.indrelid = 'listings'::regclass and i.indisunique and not i.indisprimary`,
    );
    expect(listingUniqueness.rows.map((row: { attname: string }) => row.attname).sort()).toEqual(['marketplace', 'sku']);
    const unsyncedIndex = await db.raw(`select indexdef from pg_indexes where tablename = 'listings' and indexname = 'listings_stock_unsynced_idx'`);
    expect(unsyncedIndex.rows[0].indexdef).toMatch(/\(marketplace, updated_at\) WHERE/);

    const second = capturingLogger();
    expect(await runMigrations(db, second.logger)).toBe(true);
    expect(second.lines.map(line => line.msg)).toEqual(['Database already up to date']);
    expect(await db('knex_migrations').pluck('name')).toEqual([
      '20261024120000_create_outbox_table',
      '20261024120100_create_processed_events_table',
      '20261024130000_create_marketplace_orders_table',
      '20261024130100_create_order_cursors_table',
      '20261024140000_create_listings_table',
      '20261024150000_add_stock_synced_to_listings',
    ]);
  });

  it('exits with code 1 and logs the failure when the database is unreachable', () => {
    const result = spawnSync(
      path.join(SERVICE_DIR, 'node_modules', '.bin', 'tsx'),
      ['src/infra/persistence/migrate.ts'],
      {
        cwd: SERVICE_DIR,
        env: { ...process.env, DATABASE_URL: 'postgresql://marketplace:marketplace@127.0.0.1:1/marketplace' },
        encoding: 'utf8',
        timeout: 30_000,
      },
    );

    expect(result.status).toBe(1);
    // Every line is a JSON log record, Knex warnings included.
    const records = result.stdout.trim().split('\n').map(line => JSON.parse(line) as LogLine);
    expect(records).toContainEqual(expect.objectContaining({ level: 50, msg: 'Migration failed' }));
  }, 35_000);
});
