import type { Knex } from 'knex';
import { createMigrationSource } from './src/infra/persistence/migration-source';

const config: Knex.Config = {
  client: 'pg',
  connection: process.env.DATABASE_URL ?? 'postgresql://orders:orders@localhost:5434/orders',
  migrations: { migrationSource: createMigrationSource() },
};

export default config;
