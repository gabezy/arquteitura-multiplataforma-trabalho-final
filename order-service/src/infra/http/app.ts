import express, { Express } from 'express';
import { Logger } from 'pino';
import { healthRoutes } from './health/health.routes';
import { errorHandler } from './error-handler';
import { OrderController } from './order/order.controller';
import { orderRoutes } from './order/order.routes';
import { SalesReportController } from './report/sales-report.controller';
import { salesReportRoutes } from './report/sales-report.routes';

interface AppProps {
  logger: Logger;
  checkDatabase: () => Promise<void>;
  orderController: OrderController;
  salesReportController: SalesReportController;
}

export function createApp(props: AppProps): Express {
  const app = express();
  app.use(express.json());
  app.use(healthRoutes(props.checkDatabase, props.logger));
  app.use(orderRoutes(props.orderController));
  app.use(salesReportRoutes(props.salesReportController));
  app.use(errorHandler(props.logger));
  return app;
}
