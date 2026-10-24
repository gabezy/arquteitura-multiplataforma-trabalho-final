import { Knex } from 'knex';
import { OrderFacade } from '../core/order/order.facade';
import { SalesReportFacade } from '../core/order/sales-report.facade';
import { OrderController } from './http/order/order.controller';
import { SalesReportController } from './http/report/sales-report.controller';
import { toOrderIntegrationEvent } from './messaging/order.integration-events';
import { KnexOrderRepository } from './persistence/knex-order.repository';
import { KnexOutboxRepository } from './persistence/knex-outbox.repository';

interface OrderModuleProps {
  db: Knex;
}

export interface OrderModule {
  orderController: OrderController;
  salesReportController: SalesReportController;
}

export function createOrderModule(props: OrderModuleProps): OrderModule {
  const repository = new KnexOrderRepository(props.db, new KnexOutboxRepository(toOrderIntegrationEvent));
  const orderFacade = new OrderFacade(repository);
  const salesReportFacade = new SalesReportFacade(repository);

  return {
    orderController: new OrderController(orderFacade),
    salesReportController: new SalesReportController(salesReportFacade),
  };
}
