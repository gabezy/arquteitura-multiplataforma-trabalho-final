import { Knex } from 'knex';

// The compose and Dockerfile healthchecks give up after 5 s, so a hung connection
// must turn into an answer well before that.
const PROBE_TIMEOUT_MS = 2_000;

export type DatabaseProbe = () => Promise<void>;

export function createDatabaseProbe(db: Knex): DatabaseProbe {
  return async () => {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Database did not answer within ${PROBE_TIMEOUT_MS} ms`)),
        PROBE_TIMEOUT_MS,
      );
    });

    try {
      await Promise.race([db.raw('select 1'), timeout]);
    } finally {
      clearTimeout(timer);
    }
  };
}
