import { Knex } from 'knex';
import { Consumer, Producer } from 'kafkajs';
import { Logger } from 'pino';
import { ProductFacade } from '../core/product/product.facade';
import { KnexProductRepository } from './persistence/knex-product.repository';
import { KnexOutboxRepository } from './persistence/knex-outbox.repository';
import { ProductController } from './http/product/product.controller';
import { ProductAnalysisConsumer, ProductAnalysisTopics } from './messaging/product-analysis.consumer';
import { toProductIntegrationEvent } from './messaging/product.integration-events';
import { toStockIntegrationEvent } from './messaging/stock.integration-events';
import { OrderStockConsumer, OrderStockTopics } from './messaging/order-stock.consumer';
import { KnexStockReservationRepository } from './persistence/knex-stock-reservation.repository';
import { StockFacade } from '../core/stock/stock.facade';

interface ProductModuleProps {
  db: Knex;
  consumer: Consumer;
  producer: Producer;
  productAnalysisTopics: ProductAnalysisTopics;
  orderStockKafkaConsumer: Consumer;
  orderStockTopics: OrderStockTopics;
  logger: Logger;
}

export interface ProductModule {
  productController: ProductController;
  productAnalysisConsumer: ProductAnalysisConsumer;
  orderStockConsumer: OrderStockConsumer;
}

export function createProductModule(props: ProductModuleProps): ProductModule {
  const productRepository = new KnexProductRepository(props.db, new KnexOutboxRepository(toProductIntegrationEvent));
  const productFacade = new ProductFacade(productRepository);
  const stockFacade = new StockFacade(
    productRepository,
    new KnexStockReservationRepository(props.db, new KnexOutboxRepository(toStockIntegrationEvent)),
  );

  return {
    productController: new ProductController(productFacade, productFacade, productFacade),
    productAnalysisConsumer: new ProductAnalysisConsumer(
      productFacade,
      props.consumer,
      props.producer,
      props.productAnalysisTopics,
      props.logger,
    ),
    orderStockConsumer: new OrderStockConsumer(
      stockFacade,
      stockFacade,
      props.orderStockKafkaConsumer,
      props.producer,
      props.orderStockTopics,
      props.logger,
    ),
  };
}
