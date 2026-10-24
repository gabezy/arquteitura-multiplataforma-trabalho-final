import express, { Express } from 'express';
import { Logger } from 'pino';
import { healthRoutes } from './health/health.routes';
import { errorHandler } from './error-handler';
import { listingRoutes } from './listing/listing.routes';
import { ListingController } from './listing/listing.controller';

interface AppProps {
  logger: Logger;
  checkDatabase: () => Promise<void>;
  listingController: ListingController;
}

export function createApp(props: AppProps): Express {
  const app = express();
  app.use(express.json());
  app.use(healthRoutes(props.checkDatabase, props.logger));
  app.use(listingRoutes(props.listingController));
  app.use(errorHandler(props.logger));
  return app;
}
