import express, { Express } from 'express';
import { Logger } from 'pino';
import { healthRoutes } from './health/health.routes';
import { errorHandler } from './error-handler';
import { productRoutes } from './product/product.routes';
import { ProductController } from './product/product.controller';

interface AppProps {
  logger: Logger;
  productController: ProductController;
}

export function createApp(props: AppProps): Express {
  const app = express();
  app.use(express.json());
  app.use(healthRoutes());
  app.use(productRoutes(props.productController));
  app.use(errorHandler(props.logger));
  return app;
}
