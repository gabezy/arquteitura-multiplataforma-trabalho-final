import { Knex } from 'knex';
import { Consumer, Producer } from 'kafkajs';
import { Logger } from 'pino';
import { ListingFacade } from '../core/listing/listing.facade';
import { MarketplaceRegistry } from '../core/marketplace/marketplace.registry';
import { HttpProductCatalog, HttpProductCatalogOptions } from './catalog/http-product-catalog';
import { ListingController } from './http/listing/listing.controller';
import { CatalogProductConsumer, CatalogProductTopics } from './messaging/catalog-product.consumer';
import { toListingIntegrationEvent } from './messaging/listing.integration-events';
import { KnexInboxRepository } from './persistence/knex-inbox.repository';
import { KnexListingReadRepository } from './persistence/knex-listing-read.repository';
import { KnexListingRepository } from './persistence/knex-listing.repository';
import { KnexOutboxRepository } from './persistence/knex-outbox.repository';

interface ListingModuleProps {
  db: Knex;
  marketplaces: MarketplaceRegistry;
  catalog: HttpProductCatalogOptions;
  producer: Producer;
  catalogProductKafkaConsumer: Consumer;
  catalogProductTopics: CatalogProductTopics;
  logger: Logger;
}

export interface ListingModule {
  listingController: ListingController;
  catalogProductConsumer: CatalogProductConsumer;
}

export function createListingModule(props: ListingModuleProps): ListingModule {
  const listingFacade = new ListingFacade(
    props.marketplaces,
    new KnexListingRepository(props.db, new KnexOutboxRepository(toListingIntegrationEvent)),
    new KnexListingReadRepository(props.db),
    new HttpProductCatalog(props.catalog),
  );

  return {
    listingController: new ListingController(listingFacade),
    catalogProductConsumer: new CatalogProductConsumer(
      listingFacade,
      props.catalogProductKafkaConsumer,
      props.producer,
      new KnexInboxRepository(props.db),
      props.catalogProductTopics,
      props.logger,
    ),
  };
}
