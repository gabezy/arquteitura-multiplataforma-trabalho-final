import { Knex } from 'knex';
import { Consumer, Producer } from 'kafkajs';
import { Logger } from 'pino';
import { MarketplaceRegistry } from '../core/marketplace/marketplace.registry';
import { OrderFacade } from '../core/order/order.facade';
import { OrderPollingConfig } from './config/env';
import { OrderCancelledConsumer, OrderCancelledTopics } from './messaging/order-cancelled.consumer';
import { toOrderIntegrationEvent } from './messaging/order.integration-events';
import { KnexInboxRepository } from './persistence/knex-inbox.repository';
import { KnexMarketplaceOrderRepository } from './persistence/knex-marketplace-order.repository';
import { KnexOrderCursorRepository } from './persistence/knex-order-cursor.repository';
import { KnexOutboxRepository } from './persistence/knex-outbox.repository';
import { OrderPollers } from './polling/order-pollers';

interface OrderModuleProps {
  db: Knex;
  marketplaces: MarketplaceRegistry;
  producer: Producer;
  orderCancelledKafkaConsumer: Consumer;
  orderCancelledTopics: OrderCancelledTopics;
  polling: OrderPollingConfig;
  logger: Logger;
}

export interface OrderModule {
  orderPollers: OrderPollers;
  orderCancelledConsumer: OrderCancelledConsumer;
}

export function createOrderModule(props: OrderModuleProps): OrderModule {
  const orderFacade = new OrderFacade(
    props.marketplaces,
    new KnexMarketplaceOrderRepository(props.db, new KnexOutboxRepository(toOrderIntegrationEvent)),
    new KnexOrderCursorRepository(props.db),
    { overlapMs: props.polling.overlapMs, initialLookbackMs: props.polling.initialLookbackMs },
  );

  return {
    orderPollers: new OrderPollers(orderFacade, props.marketplaces.marketplaces(), props.polling.intervalMs, props.logger),
    orderCancelledConsumer: new OrderCancelledConsumer(
      orderFacade,
      props.orderCancelledKafkaConsumer,
      props.producer,
      new KnexInboxRepository(props.db),
      props.orderCancelledTopics,
      props.logger,
    ),
  };
}
