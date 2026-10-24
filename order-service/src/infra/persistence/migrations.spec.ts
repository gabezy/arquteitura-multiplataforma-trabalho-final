import { spawnSync } from 'node:child_process';
import path from 'node:path';
import knex, { Knex } from 'knex';
import pino, { Logger } from 'pino';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createMigrationSource } from './migration-source';
import { runMigrations } from './migrator';

// Same image as order-db in ../docker-compose.yaml: the outbox uses jsonb.
const POSTGRES_IMAGE = 'postgres:18-alpine';
const CONTAINER_STARTUP_MS = 60_000;
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

  it('creates the outbox, processed_events, orders and order_items tables, then applies nothing on a second run', async () => {
    const first = capturingLogger();
    expect(await runMigrations(db, first.logger)).toBe(true);
    expect(first.lines.map(line => line.msg)).toEqual(['Applied 3 migration(s)']);

    expect(await columnsOf(db, 'outbox')).toEqual([
      { column_name: 'sequence', data_type: 'bigint', is_nullable: 'NO', column_default: expect.stringContaining('nextval') },
      { column_name: 'event_id', data_type: 'uuid', is_nullable: 'NO', column_default: null },
      { column_name: 'aggregate_type', data_type: 'character varying', is_nullable: 'NO', column_default: null },
      { column_name: 'aggregate_id', data_type: 'uuid', is_nullable: 'NO', column_default: null },
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
    expect(await columnsOf(db, 'orders')).toEqual([
      { column_name: 'id', data_type: 'uuid', is_nullable: 'NO', column_default: null },
      { column_name: 'marketplace', data_type: 'text', is_nullable: 'NO', column_default: null },
      { column_name: 'external_order_id', data_type: 'text', is_nullable: 'NO', column_default: null },
      { column_name: 'status', data_type: 'text', is_nullable: 'NO', column_default: null },
      { column_name: 'total', data_type: 'numeric', is_nullable: 'NO', column_default: null },
      { column_name: 'cancellation_reason', data_type: 'text', is_nullable: 'YES', column_default: null },
      { column_name: 'ordered_at', data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: null },
      { column_name: 'created_at', data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: null },
      { column_name: 'updated_at', data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: null },
    ]);
    expect(await columnsOf(db, 'order_items')).toEqual([
      { column_name: 'order_id', data_type: 'uuid', is_nullable: 'NO', column_default: null },
      { column_name: 'line', data_type: 'integer', is_nullable: 'NO', column_default: null },
      { column_name: 'sku', data_type: 'text', is_nullable: 'NO', column_default: null },
      { column_name: 'quantity', data_type: 'integer', is_nullable: 'NO', column_default: null },
      { column_name: 'unit_price', data_type: 'numeric', is_nullable: 'NO', column_default: null },
    ]);
    expect(await db('pg_indexes').where({ tablename: 'orders' }).orderBy('indexname').pluck('indexdef')).toEqual([
      'CREATE INDEX orders_created_at_id_index ON public.orders USING btree (created_at, id)',
      'CREATE UNIQUE INDEX orders_marketplace_external_order_id_unique ON public.orders USING btree (marketplace, external_order_id)',
      'CREATE UNIQUE INDEX orders_pkey ON public.orders USING btree (id)',
    ]);
    expect(await db('pg_indexes').where({ tablename: 'order_items' }).pluck('indexdef')).toEqual([
      'CREATE UNIQUE INDEX order_items_pkey ON public.order_items USING btree (order_id, line)',
    ]);

    const second = capturingLogger();
    expect(await runMigrations(db, second.logger)).toBe(true);
    expect(second.lines.map(line => line.msg)).toEqual(['Database already up to date']);
    expect(await db('knex_migrations').pluck('name')).toEqual([
      '20261023120000_create_outbox_table',
      '20261023120100_create_processed_events_table',
      '20261024120000_create_orders_tables',
    ]);
  });

  it('drops the orders tables when the last migration is undone', async () => {
    await db.migrate.down({ migrationSource: createMigrationSource() });

    expect(await columnsOf(db, 'orders')).toEqual([]);
    expect(await columnsOf(db, 'order_items')).toEqual([]);
    expect(await columnsOf(db, 'outbox')).not.toEqual([]);

    await db.migrate.latest({ migrationSource: createMigrationSource() });
  });

  it('exits with code 1 and logs the failure when Vault is unreachable', () => {
    const result = spawnSync(
      path.join(SERVICE_DIR, 'node_modules', '.bin', 'tsx'),
      ['src/infra/persistence/migrate.ts'],
      {
        cwd: SERVICE_DIR,
        env: { ...process.env, VAULT_ADDR: 'http://127.0.0.1:1', VAULT_ROLE_ID: 'role', VAULT_SECRET_ID: 'secret' },
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
