import { loadConfig } from './infra/config/env';
import { createLogger } from './infra/observability/logger';
import { createApp } from './infra/http/app';
import { createDatabaseConnection } from './infra/config/database';
import { KnexProductRepository } from './infra/persistence/knex-product.repository';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const db = createDatabaseConnection(config.databaseUrl);
const productRepository = new KnexProductRepository(db);

createApp({ logger, productRepository }).listen(config.port, () => {
  logger.info({ port: config.port }, `${config.serviceName} listening`);
});

process.on('SIGTERM', async () => {
  await db.destroy();
  process.exit(0);
});
