import express, { Express } from 'express';
import { Logger } from 'pino';
import { healthRoutes } from './health/health.routes';
import { errorHandler } from './error-handler';
import { productRoutes } from './product/product.routes';
import { ProductController } from './product/product.controller';
import { OutboxRelay } from '../messaging/outbox-relay';
import { ProductAnalysisConsumer } from '../messaging/product-analysis.consumer';

interface AppProps {
  logger: Logger;
  productController: ProductController;
  relay: OutboxRelay;
  productAnalysisConsumer: ProductAnalysisConsumer;
}

export function createApp(props: AppProps): Express {
  const app = express();
  app.use(express.json());
  app.use(healthRoutes());
  app.use(productRoutes(props.productController));
  app.use(errorHandler(props.logger));

  props.productAnalysisConsumer.start().catch(err => {
    props.logger.error({ err }, 'Failed to start ProductAnalysisConsumer');
    process.exit(1);
  });

  setInterval(() => {
    props.relay.relay().catch(err => {
      props.logger.error({ err }, 'Failed to relay outbox messages');
    });
  }, 1000);

  return app;
}
