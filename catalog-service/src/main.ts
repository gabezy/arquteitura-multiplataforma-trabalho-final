import { loadAppConfig } from './infra/config/load-app-config';
import { createLogger } from './infra/observability/logger';
import { createApp } from './infra/http/app';
import { createDatabaseConnection } from './infra/persistence/database';
import { createProductModule } from './infra/product.factory';
import { configureKafka } from './infra/messaging/kafka.config';
import { OutboxRelay } from './infra/messaging/outbox-relay';

const RELAY_INTERVAL_MS = 1000;

async function start(): Promise<void> {
  const config = await loadAppConfig();
  const logger = createLogger(config.logLevel);
  const db = createDatabaseConnection(config.databaseUrl);
  const { consumer, producer, orderStockConsumer: orderStockKafkaConsumer } = configureKafka(config.kafkaBrokers);

  const { productController, productAnalysisConsumer, orderStockConsumer } = createProductModule({
    db,
    consumer,
    producer,
    productAnalysisTopics: {
      topic: config.produtoAnalisadoTopic,
      deadLetterTopic: config.productAnalysisDeadLetterTopic,
    },
    orderStockKafkaConsumer,
    orderStockTopics: {
      placedTopic: config.orderPlacedTopic,
      cancelledTopic: config.orderCancelledTopic,
      deadLetterTopic: config.orderStockDeadLetterTopic,
    },
    logger,
  });
  const relay = new OutboxRelay(db, producer);

  await producer.connect();
  await productAnalysisConsumer.start();
  await orderStockConsumer.start();

  relay.start({
    intervalMs: RELAY_INTERVAL_MS,
    onError: err => logger.error({ err }, 'Failed to relay outbox messages'),
  });

  const server = createApp({ logger, productController }).listen(config.port, () => {
    logger.info({ port: config.port }, `${config.serviceName} listening`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, `${config.serviceName} shutting down`);
    server.close();
    await consumer.disconnect();
    await orderStockKafkaConsumer.disconnect();
    await relay.stop();
    await producer.disconnect();
    await db.destroy();
    process.exit(0);
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

start().catch(err => {
  // The config may be what failed (e.g. Vault unreachable), so this logger does not depend on it.
  createLogger(process.env.LOG_LEVEL ?? 'info').error({ err }, 'catalog-service failed to start');
  process.exit(1);
});
