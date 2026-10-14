import type { Knex } from 'knex';
import { createMigrationSource } from './src/infra/persistence/migration-source';

const config: Knex.Config = {
  client: 'pg',
  connection: process.env.DATABASE_URL ?? 'postgres://catalog:catalog@localhost:5432/catalog',
  migrations: { migrationSource: createMigrationSource() },
};

export default config;
