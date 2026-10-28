import { Knex } from 'knex';
import { Logger } from 'pino';
import { createMigrationSource } from './migration-source';

// Applies pending migrations and reports whether the schema is up to date.
export async function runMigrations(db: Knex, logger: Logger): Promise<boolean> {
  try {
    const [batch, migrations] = await db.migrate.latest({ migrationSource: createMigrationSource() });
    if (migrations.length === 0) {
      logger.info('Database already up to date');
    } else {
      logger.info({ batch, migrations }, `Applied ${migrations.length} migration(s)`);
    }
    return true;
  } catch (err) {
    logger.error({ err }, 'Migration failed');
    return false;
  }
}
