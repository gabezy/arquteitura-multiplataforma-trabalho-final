import { loadAppConfig } from '../config/load-app-config';
import { createLogger } from '../observability/logger';
import { createDatabaseConnection } from './database';
import { runMigrations } from './migrator';

// SPEC_DEVIATION: BOOT-19 names only main.ts and *.factory.ts as places that build adapters.
// Reason: this is the entry point of the migration process the Docker image runs before main.ts.
async function migrate(): Promise<void> {
  const logger = createLogger(process.env.LOG_LEVEL ?? 'info');

  let databaseUrl: string;
  try {
    ({ databaseUrl } = await loadAppConfig());
  } catch (err) {
    // The credentials come from Vault, so a Vault outage fails the migration like a database outage.
    logger.error({ err }, 'Migration failed');
    process.exitCode = 1;
    return;
  }

  const db = createDatabaseConnection(databaseUrl, logger);
  try {
    if (!(await runMigrations(db, logger))) {
      process.exitCode = 1;
    }
  } finally {
    await db.destroy();
  }
}

void migrate();
