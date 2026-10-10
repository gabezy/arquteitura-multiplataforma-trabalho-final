import type { Knex } from 'knex';

const config: Knex.Config = {
  client: 'pg',
  connection: process.env.DATABASE_URL ?? 'postgres://catalog:catalog@localhost:5432/catalog',
  migrations: { directory: './src/infra/persistence/migrations', extension: 'ts' },
};

export default config;