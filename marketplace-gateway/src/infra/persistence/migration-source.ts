import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { Knex } from 'knex';

const MIGRATION_FILE = /\.(ts|js)$/;
const DECLARATION_FILE = /\.d\.ts$/;

// Records migrations without the file extension, so the same migration has the
// same name whether it runs from src/ (.ts, via tsx) or from dist/ (.js).
export class ExtensionlessMigrationSource implements Knex.MigrationSource<string> {

  constructor(private readonly directory: string) {}

  async getMigrations(): Promise<string[]> {
    const files = await readdir(this.directory);
    return files
      .filter((file) => MIGRATION_FILE.test(file) && !DECLARATION_FILE.test(file))
      .sort();
  }

  getMigrationName(file: string): string {
    return path.parse(file).name;
  }

  async getMigration(file: string): Promise<Knex.Migration> {
    return require(path.join(this.directory, file));
  }

}

export function createMigrationSource(): ExtensionlessMigrationSource {
  return new ExtensionlessMigrationSource(path.join(__dirname, 'migrations'));
}
