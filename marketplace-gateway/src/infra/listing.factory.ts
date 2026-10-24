import { Knex } from 'knex';
import { Consumer, Producer } from 'kafkajs';
import { Logger } from 'pino';
import { ListingFacade } from '../core/listing/listing.facade';
import { StockFacade } from '../core/listing/stock.facade';
import { MarketplaceRegistry } from '../core/marketplace/marketplace.registry';
import { HttpProductCatalog, HttpProductCatalogOptions } from './catalog/http-product-catalog';
import { ListingController } from './http/listing/listing.controller';
import { CatalogProductConsumer, CatalogProductTopics } from './messaging/catalog-product.consumer';
import { toListingIntegrationEvent } from './messaging/listing.integration-events';
import { KnexInboxRepository } from './persistence/knex-inbox.repository';
import { KnexListingReadRepository } from './persistence/knex-listing-read.repository';
import { KnexListingStockRepository } from './persistence/knex-listing-stock.repository';
import { KnexListingRepository } from './persistence/knex-listing.repository';
import { KnexOutboxRepository } from './persistence/knex-outbox.repository';
import { StockSynchronizers } from './polling/stock-synchronizers';
import { PriceSynchronizers } from './polling/price-synchronizers';

interface ListingModuleProps {
  db: Knex;
  marketplaces: MarketplaceRegistry;
  catalog: HttpProductCatalogOptions;
  producer: Producer;
  catalogProductKafkaConsumer: Consumer;
  catalogProductTopics: CatalogProductTopics;
  stockSync: { intervalMs: number; batchSize: number };
  priceSync?: { intervalMs: number; batchSize: number };
  logger: Logger;
}

export interface ListingModule {
  listingController: ListingController;
  catalogProductConsumer: CatalogProductConsumer;
  stockSynchronizers: StockSynchronizers;
  priceSynchronizers?: PriceSynchronizers;
}

export function createListingModule(props: ListingModuleProps): ListingModule {
  const listingFacade = new ListingFacade(
    props.marketplaces,
    new KnexListingRepository(props.db, new KnexOutboxRepository(toListingIntegrationEvent)),
    new KnexListingReadRepository(props.db),
    new HttpProductCatalog(props.catalog),
  );
  const stockFacade = new StockFacade(props.marketplaces, new KnexListingStockRepository(props.db), props.stockSync.batchSize);

  return {
    listingController: new ListingController(listingFacade),
    catalogProductConsumer: new CatalogProductConsumer(
      listingFacade,
      stockFacade,
      stockFacade,
      props.catalogProductKafkaConsumer,
      props.producer,
      new KnexInboxRepository(props.db),
      props.catalogProductTopics,
      props.logger,
    ),
    stockSynchronizers: new StockSynchronizers(stockFacade, props.marketplaces.marketplaces(), props.stockSync.intervalMs, props.logger),
    priceSynchronizers: new PriceSynchronizers(stockFacade, props.marketplaces.marketplaces(), props.priceSync?.intervalMs ?? props.stockSync.intervalMs, props.logger),
  };
}
