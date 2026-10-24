import { Knex } from 'knex';
import { Consumer, Producer } from 'kafkajs';
import { Logger } from 'pino';
import { OrderFacade } from '../core/order/order.facade';
import { SalesReportFacade } from '../core/order/sales-report.facade';
import { OrderController } from './http/order/order.controller';
import { SalesReportController } from './http/report/sales-report.controller';
import { toOrderIntegrationEvent } from './messaging/order.integration-events';
import { MarketplaceOrderConsumer } from './messaging/marketplace-order.consumer';
import { KnexInbox } from './persistence/knex-inbox';
import { KnexOrderRepository } from './persistence/knex-order.repository';
import { KnexOutboxRepository } from './persistence/knex-outbox.repository';

interface OrderModuleProps {
  db: Knex;
  producer: Producer;
  marketplaceOrderKafkaConsumer: Consumer;
  logger: Logger;
}

export interface OrderModule {
  orderController: OrderController;
  salesReportController: SalesReportController;
  marketplaceOrderConsumer: MarketplaceOrderConsumer;
}

export function createOrderModule(props: OrderModuleProps): OrderModule {
  const repository = new KnexOrderRepository(props.db, new KnexOutboxRepository(toOrderIntegrationEvent));
  const orderFacade = new OrderFacade(repository);
  const salesReportFacade = new SalesReportFacade(repository);

  return {
    orderController: new OrderController(orderFacade),
    salesReportController: new SalesReportController(salesReportFacade),
    marketplaceOrderConsumer: new MarketplaceOrderConsumer({
      consumer: props.marketplaceOrderKafkaConsumer,
      producer: props.producer,
      inbox: new KnexInbox(props.db),
      receiveOrder: orderFacade,
      logger: props.logger,
    }),
  };
}
