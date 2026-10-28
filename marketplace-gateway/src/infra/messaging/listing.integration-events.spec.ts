import { Listing } from '../../core/listing/model/listing.entity';
import { DomainEvent } from '../../core/shared/domain/domain.event';
import { toListingIntegrationEvent } from './listing.integration-events';

const PRODUCT_ID = '0b8f2c1e-6a4d-4d1e-9a51-3f0f1b2c7d10';
const PUBLISHED_AT = new Date('2026-10-28T13:05:02.123Z');

class Unrelated extends DomainEvent {
  readonly eventName = 'Unrelated';

  constructor() {
    super('x');
  }
}

const newListing = () =>
  Listing.pending({ productId: PRODUCT_ID, sku: 'NB-001', marketplace: 'SHOPEE', price: 4500, stock: 2 }, new Date());

describe('toListingIntegrationEvent', () => {
  it('turns a published listing into marketplace.listing.published.v1, with the data of the contract', () => {
    const listing = newListing();
    listing.markPublished('412525791', PUBLISHED_AT);
    const [event] = listing.pullDomainEvents();

    expect(toListingIntegrationEvent(event)).toEqual({
      type: 'marketplace.listing.published.v1',
      data: {
        productId: PRODUCT_ID,
        sku: 'NB-001',
        marketplace: 'SHOPEE',
        externalListingId: '412525791',
        publishedAt: '2026-10-28T13:05:02.123Z',
      },
    });
  });

  it('turns a failed listing into marketplace.listing.failed.v1, with the data of the contract', () => {
    const listing = newListing();
    listing.markFailed('HTTP 503', 3, PUBLISHED_AT);
    const [event] = listing.pullDomainEvents();

    expect(toListingIntegrationEvent(event)).toEqual({
      type: 'marketplace.listing.failed.v1',
      data: { productId: PRODUCT_ID, sku: 'NB-001', marketplace: 'SHOPEE', reason: 'HTTP 503', attempts: 3 },
    });
  });

  it('keys both events by the product', () => {
    const published = newListing();
    published.markPublished('1', PUBLISHED_AT);
    const failed = newListing();
    failed.markFailed('HTTP 503', 3, PUBLISHED_AT);

    expect(published.pullDomainEvents()[0].aggregateId).toBe(PRODUCT_ID);
    expect(failed.pullDomainEvents()[0].aggregateId).toBe(PRODUCT_ID);
  });

  it('refuses an event that has no public contract', () => {
    expect(() => toListingIntegrationEvent(new Unrelated())).toThrow('No integration event for Unrelated.');
  });
});
