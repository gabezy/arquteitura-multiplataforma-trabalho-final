import type { Knex } from 'knex';
import { createMigrationSource } from './src/infra/persistence/migration-source';

const config: Knex.Config = {
  client: 'pg',
  connection: process.env.DATABASE_URL ?? 'postgresql://marketplace:marketplace@localhost:5436/marketplace',
  migrations: { migrationSource: createMigrationSource() },
};

export default config;
