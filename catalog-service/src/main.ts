import { loadConfig } from './infra/config/env';
import { createLogger } from './infra/observability/logger';
import { createApp } from './infra/http/app';
import { createDatabaseConnection } from './infra/persistence/database';
import { createProductController } from './infra/product.factory';
import { configureKafka } from './infra/messaging/kafka.config';
import { KnexOutboxRepository } from './infra/persistence/knex-outbox.repository';
import { KnexProductRepository } from './infra/persistence/knex-product.repository';
import { ProductFacade } from './core/product/product.facade';
import { ProductController } from './infra/http/product/product.controller';
import { OutboxRelay } from './infra/messaging/outbox-relay';
import { ProductAnalysisConsumer } from './infra/messaging/product-analysis.consumer';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const db = createDatabaseConnection(config.databaseUrl);

const { consumer, producer } = configureKafka();

const productFacade = new ProductFacade(new KnexProductRepository(db, new KnexOutboxRepository()));
const productController = new ProductController(productFacade, productFacade, productFacade);
const relay = new OutboxRelay(db, producer, config.produtoCriadoTopic);
const productAnalysisConsumer = new ProductAnalysisConsumer(productFacade, consumer, config.produtoAnalisadoTopic, logger);

createApp({ logger, productController, relay, productAnalysisConsumer }).listen(config.port, () => {
  logger.info({ port: config.port }, `${config.serviceName} listening`);
});

process.on('SIGTERM', async () => {
  await db.destroy();
  process.exit(0);
});
