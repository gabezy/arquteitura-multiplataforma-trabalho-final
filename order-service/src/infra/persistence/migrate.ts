import { loadConfig } from '../config/env';
import { createLogger } from '../observability/logger';
import { createDatabaseConnection } from './database';
import { runMigrations } from './migrator';

// SPEC_DEVIATION: BOOT-19 names only main.ts and *.factory.ts as places that build adapters.
// Reason: this is the entry point of the migration process the Docker image runs before main.ts.
async function migrate(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const db = createDatabaseConnection(config.databaseUrl, logger);

  try {
    if (!(await runMigrations(db, logger))) {
      process.exitCode = 1;
    }
  } finally {
    await db.destroy();
  }
}

void migrate();
