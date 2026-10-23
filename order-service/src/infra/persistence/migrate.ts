import { loadConfig } from '../config/env';
import { createLogger } from '../observability/logger';
import { createDatabaseConnection } from './database';
import { runMigrations } from './migrator';

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
