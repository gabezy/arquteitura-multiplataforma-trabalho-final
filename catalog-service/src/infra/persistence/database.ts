import knex, { Knex } from 'knex'

export function createDatabaseConnection(databaseUrl: string): Knex {
  return knex({
    client: 'pg',
    connection: databaseUrl,
    pool: { min: 0, max: 5 },
  });
}