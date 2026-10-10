import { loadConfig } from '../config/env';
import { createLogger } from '../observability/logger';
import { createDatabaseConnection } from './database';
import { createMigrationSource } from './migration-source';

async function migrate(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const db = createDatabaseConnection(config.databaseUrl);

  try {
    const [batch, migrations] = await db.migrate.latest({ migrationSource: createMigrationSource() });
    if (migrations.length === 0) {
      logger.info('Database already up to date');
    } else {
      logger.info({ batch, migrations }, `Applied ${migrations.length} migration(s)`);
    }
  } catch (err) {
    logger.error({ err }, 'Migration failed');
    process.exitCode = 1;
  } finally {
    await db.destroy();
  }
}

void migrate();
