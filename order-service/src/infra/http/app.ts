import express, { Express, Router } from 'express';
import { Logger } from 'pino';
import { healthRoutes } from './health/health.routes';
import { errorHandler } from './error-handler';

interface AppProps {
  logger: Logger;
  checkDatabase: () => Promise<void>;
  orderRoutes: Router;
}

export function createApp(props: AppProps): Express {
  const app = express();
  app.use(express.json());
  app.use(healthRoutes(props.checkDatabase, props.logger));
  app.use(props.orderRoutes);
  app.use(errorHandler(props.logger));
  return app;
}
