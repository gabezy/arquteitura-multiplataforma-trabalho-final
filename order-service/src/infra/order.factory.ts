import { Knex } from 'knex';
import { Consumer, Producer } from 'kafkajs';
import { Logger } from 'pino';
import { OrderFacade } from '../core/order/order.facade';
import { SalesReportFacade } from '../core/order/sales-report.facade';
import { OrderController } from './http/order/order.controller';
import { SalesReportController } from './http/report/sales-report.controller';
import { BILLING_PAYMENT_DEAD_LETTER_TOPIC, BILLING_PAYMENT_SOURCE, billingPaymentTopics } from './messaging/billing-payment.topics';
import { MarketplaceOrderConsumer } from './messaging/marketplace-order.consumer';
import { OrderOutcomeConsumer } from './messaging/order-outcome.consumer';
import { toOrderIntegrationEvent } from './messaging/order.integration-events';
import { STOCK_RESPONSE_DEAD_LETTER_TOPIC, STOCK_RESPONSE_SOURCE, stockResponseTopics } from './messaging/stock-response.topics';
import { KnexInbox } from './persistence/knex-inbox';
import { KnexOrderRepository } from './persistence/knex-order.repository';
import { KnexOutboxRepository } from './persistence/knex-outbox.repository';

interface OrderModuleProps {
  db: Knex;
  producer: Producer;
  marketplaceOrderKafkaConsumer: Consumer;
  stockResponseKafkaConsumer: Consumer;
  billingPaymentKafkaConsumer: Consumer;
  logger: Logger;
}

export interface OrderModule {
  orderController: OrderController;
  salesReportController: SalesReportController;
  marketplaceOrderConsumer: MarketplaceOrderConsumer;
  stockResponseConsumer: OrderOutcomeConsumer;
  billingPaymentConsumer: OrderOutcomeConsumer;
}

export function createOrderModule(props: OrderModuleProps): OrderModule {
  const repository = new KnexOrderRepository(props.db, new KnexOutboxRepository(toOrderIntegrationEvent));
  const orderFacade = new OrderFacade(repository);
  const salesReportFacade = new SalesReportFacade(repository);
  const inbox = new KnexInbox(props.db);

  return {
    orderController: new OrderController(orderFacade),
    salesReportController: new SalesReportController(salesReportFacade),
    marketplaceOrderConsumer: new MarketplaceOrderConsumer({
      consumer: props.marketplaceOrderKafkaConsumer,
      producer: props.producer,
      inbox,
      receiveOrder: orderFacade,
      logger: props.logger,
    }),
    stockResponseConsumer: new OrderOutcomeConsumer({
      consumer: props.stockResponseKafkaConsumer,
      producer: props.producer,
      inbox,
      logger: props.logger,
      source: STOCK_RESPONSE_SOURCE,
      deadLetterTopic: STOCK_RESPONSE_DEAD_LETTER_TOPIC,
      topics: stockResponseTopics(orderFacade),
    }),
    billingPaymentConsumer: new OrderOutcomeConsumer({
      consumer: props.billingPaymentKafkaConsumer,
      producer: props.producer,
      inbox,
      logger: props.logger,
      source: BILLING_PAYMENT_SOURCE,
      deadLetterTopic: BILLING_PAYMENT_DEAD_LETTER_TOPIC,
      topics: billingPaymentTopics(orderFacade),
    }),
  };
}
