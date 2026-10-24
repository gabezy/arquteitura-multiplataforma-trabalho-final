import type { Knex } from 'knex';
import { loadAppConfig } from './src/infra/config/load-app-config';
import { createMigrationSource } from './src/infra/persistence/migration-source';

const config: Knex.Config = {
  client: 'pg',
  connection: async () => (await loadAppConfig()).databaseUrl,
  migrations: { migrationSource: createMigrationSource() },
};

export default config;
