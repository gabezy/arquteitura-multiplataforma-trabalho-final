import { Router } from 'express';
import { Knex } from 'knex';
import { Consumer, Producer } from 'kafkajs';
import { Logger } from 'pino';
import { OrderFacade } from '../core/order/order.facade';
import { orderRoutes } from './http/order/order.routes';
import { MarketplaceOrderConsumer } from './messaging/marketplace-order.consumer';
import { toOrderIntegrationEvent } from './messaging/order.integration-events';
import { KnexInbox } from './persistence/knex-inbox';
import { KnexOrderRepository } from './persistence/knex-order.repository';
import { KnexOutboxRepository } from './persistence/knex-outbox.repository';

const MARKETPLACE_ORDER_TOPICS = {
  topic: 'marketplace.order.received.v1',
  deadLetterTopic: 'order.marketplace-order.dlq',
};

interface OrderModuleProps {
  db: Knex;
  producer: Producer;
  marketplaceOrderKafkaConsumer: Consumer;
  logger: Logger;
}

export interface OrderModule {
  orderRoutes: Router;
  marketplaceOrderConsumer: MarketplaceOrderConsumer;
}

export function createOrderModule(props: OrderModuleProps): OrderModule {
  const orderFacade = new OrderFacade(new KnexOrderRepository(props.db, new KnexOutboxRepository(toOrderIntegrationEvent)));

  return {
    orderRoutes: orderRoutes(orderFacade, orderFacade),
    marketplaceOrderConsumer: new MarketplaceOrderConsumer(
      orderFacade,
      props.marketplaceOrderKafkaConsumer,
      props.producer,
      new KnexInbox(props.db),
      MARKETPLACE_ORDER_TOPICS,
      props.logger,
    ),
  };
}
