import type { Logger } from 'pino';
import { loadAppConfig } from '../config/load-app-config';
import { createLogger } from '../observability/logger';
import { createDatabaseConnection } from './database';
import { createMigrationSource } from './migration-source';

async function migrate(): Promise<void> {
  const logger = createLogger(process.env.LOG_LEVEL ?? 'info');

  try {
    const config = await loadAppConfig();
    await applyMigrations(config.databaseUrl, logger);
  } catch (err) {
    logger.error({ err }, 'Migration failed');
    process.exitCode = 1;
  }
}

async function applyMigrations(databaseUrl: string, logger: Logger): Promise<void> {
  const db = createDatabaseConnection(databaseUrl);

  try {
    const [batch, migrations] = await db.migrate.latest({ migrationSource: createMigrationSource() });
    if (migrations.length === 0) {
      logger.info('Database already up to date');
    } else {
      logger.info({ batch, migrations }, `Applied ${migrations.length} migration(s)`);
    }
  } finally {
    await db.destroy();
  }
}

void migrate();
