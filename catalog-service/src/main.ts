import { loadConfig } from './infra/config/env';
import { createLogger } from './infra/observability/logger';
import { createApp } from './infra/http/app';
import { createDatabaseConnection } from './infra/persistence/database';
import { createProductController } from './infra/product.factory';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const db = createDatabaseConnection(config.databaseUrl);

const productController = createProductController(db);

createApp({ logger, productController }).listen(config.port, () => {
  logger.info({ port: config.port }, `${config.serviceName} listening`);
});

process.on('SIGTERM', async () => {
  await db.destroy();
  process.exit(0);
});
