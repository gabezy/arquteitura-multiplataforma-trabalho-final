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

  it.each(['20261010132157_create_products_table.ts', '20261010132157_create_products_table.js'])('names %s without the extension', (file) => {
    expect(new ExtensionlessMigrationSource(directory).getMigrationName(file)).toBe('20261010132157_create_products_table');
  });

  it('loads the up and down functions of a migration', async () => {
    await writeFile(path.join(directory, '001_a.js'), 'exports.up = () => "up"; exports.down = () => "down";');

    const migration = await new ExtensionlessMigrationSource(directory).getMigration('001_a.js');

    expect(migration.up).toEqual(expect.any(Function));
    expect(migration.down).toEqual(expect.any(Function));
  });

  it('reads the migrations folder next to it', async () => {
    const migrations = await createMigrationSource().getMigrations();

    expect(migrations).toContain('20261010132157_create_products_table.ts');
  });
});
