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

  it('creates the outbox and processed_events tables, then applies nothing on a second run', async () => {
    const first = capturingLogger();
    expect(await runMigrations(db, first.logger)).toBe(true);
    expect(first.lines.map(line => line.msg)).toEqual(['Applied 2 migration(s)']);

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

    const second = capturingLogger();
    expect(await runMigrations(db, second.logger)).toBe(true);
    expect(second.lines.map(line => line.msg)).toEqual(['Database already up to date']);
    expect(await db('knex_migrations').pluck('name')).toEqual([
      '20261024120000_create_outbox_table',
      '20261024120100_create_processed_events_table',
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
