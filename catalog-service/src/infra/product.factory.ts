import { Knex } from 'knex';
import { Consumer, Producer } from 'kafkajs';
import { Logger } from 'pino';
import { ProductFacade } from '../core/product/product.facade';
import { KnexProductRepository } from './persistence/knex-product.repository';
import { KnexOutboxRepository } from './persistence/knex-outbox.repository';
import { ProductController } from './http/product/product.controller';
import { ProductAnalysisConsumer, ProductAnalysisTopics } from './messaging/product-analysis.consumer';
import { toProductIntegrationEvent } from './messaging/product.integration-events';

interface ProductModuleProps {
  db: Knex;
  consumer: Consumer;
  producer: Producer;
  productAnalysisTopics: ProductAnalysisTopics;
  logger: Logger;
}

export interface ProductModule {
  productController: ProductController;
  productAnalysisConsumer: ProductAnalysisConsumer;
}

export function createProductModule(props: ProductModuleProps): ProductModule {
  const productFacade = new ProductFacade(new KnexProductRepository(props.db, new KnexOutboxRepository(toProductIntegrationEvent)));

  return {
    productController: new ProductController(productFacade, productFacade, productFacade),
    productAnalysisConsumer: new ProductAnalysisConsumer(
      productFacade,
      props.consumer,
      props.producer,
      props.productAnalysisTopics,
      props.logger,
    ),
  };
}
