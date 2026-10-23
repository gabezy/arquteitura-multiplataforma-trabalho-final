import express, { Express } from 'express';
import { Logger } from 'pino';
import { errorHandler } from './error-handler';

interface AppProps {
  logger: Logger;
}

export function createApp(props: AppProps): Express {
  const app = express();
  app.use(express.json());
  app.use(errorHandler(props.logger));
  return app;
}
