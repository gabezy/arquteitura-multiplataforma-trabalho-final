import express, { Express } from 'express';
import { Logger } from 'pino';
import { healthRoutes } from './health/health.routes';
import { errorHandler } from './error-handler';

export function createApp(logger: Logger): Express {
  const app = express();
  app.use(express.json());
  app.use(healthRoutes());
  app.use(errorHandler(logger));
  return app;
}
