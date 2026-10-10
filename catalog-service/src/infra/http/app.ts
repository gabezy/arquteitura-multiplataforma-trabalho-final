import express, { Express } from 'express';
import { Logger } from 'pino';
import { healthRoutes } from './health/health.routes';
import { errorHandler } from './error-handler';
import { ProductRepository } from '../../core/product/port/out/product.repository';

interface AppProps {
  logger: Logger;
  productRepository: ProductRepository;
}

export function createApp(props: AppProps): Express {
  const app = express();
  app.use(express.json());
  app.use(healthRoutes());
  app.use(errorHandler(props.logger));
  return app;
}
