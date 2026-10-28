import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ExtensionlessMigrationSource, createMigrationSource } from './migration-source';

describe('ExtensionlessMigrationSource', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'migrations-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('lists .ts and .js migrations in name order, skipping maps and declarations', async () => {
    for (const file of ['002_b.js', '001_a.ts', '002_b.js.map', '001_a.d.ts', 'README.md']) {
      await writeFile(path.join(directory, file), '');
    }

    const migrations = await new ExtensionlessMigrationSource(directory).getMigrations();

    expect(migrations).toEqual(['001_a.ts', '002_b.js']);
  });

  it.each(['20261024120000_create_outbox_table.ts', '20261024120000_create_outbox_table.js'])(
    'names %s without the extension',
    file => {
      expect(new ExtensionlessMigrationSource(directory).getMigrationName(file)).toBe('20261024120000_create_outbox_table');
    },
  );

  it('reads the migrations folder next to it', async () => {
    const migrations = await createMigrationSource().getMigrations();

    expect(migrations).toEqual([
      '20261024120000_create_outbox_table.ts',
      '20261024120100_create_processed_events_table.ts',
      '20261024130000_create_marketplace_orders_table.ts',
      '20261024130100_create_order_cursors_table.ts',
      '20261024140000_create_listings_table.ts',
      '20261024150000_add_stock_synced_to_listings.ts',
      '20261025120000_add_price_synced_to_listings.ts',
    ]);
  });
});
