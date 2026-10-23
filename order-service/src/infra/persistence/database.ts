import knex, { Knex } from 'knex';
import { Logger } from 'pino';

export function createDatabaseConnection(databaseUrl: string, logger: Logger): Knex {
  return knex({
    client: 'pg',
    connection: databaseUrl,
    pool: { min: 0, max: 5 },
    // Knex writes its own warnings to the console; routing them through pino keeps every
    // line the service writes a JSON record that Loki can parse.
    log: {
      warn: (message: string) => logger.warn(message),
      error: (message: string) => logger.error(message),
      deprecate: (method: string, alternative: string) => logger.warn(`${method} is deprecated, use ${alternative}`),
      debug: (message: unknown) => logger.debug({ knex: message }, 'knex debug'),
    },
  });
}
