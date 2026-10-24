import { ConflictError, ValidationError } from '../../shared/domain/domain.error';
import { Id } from '../../shared/domain/id';
import { Listing, ListingState } from './listing.entity';
import { InvalidListingError, InvalidListingTransitionError } from './listing.errors';
import { ListingFailed, ListingPublished } from './listing.events';

const PRODUCT_ID = '0b8f2c1e-6a4d-4d1e-9a51-3f0f1b2c7d10';
const CREATED_AT = new Date('2026-10-28T13:00:00.000Z');
const LATER = new Date('2026-10-28T13:00:05.000Z');

const pending = (overrides: Partial<{ price: number; stock: number; sku: string }> = {}) =>
  Listing.pending({ productId: PRODUCT_ID, sku: 'nb-001', marketplace: 'SHOPEE', price: 4500, stock: 2, ...overrides }, CREATED_AT);

describe('Listing', () => {
  describe('a new listing', () => {
    it('is pending, with the SKU in capitals and nothing from the marketplace yet', () => {
      const listing = pending();

      expect(listing).toMatchObject({
        productId: PRODUCT_ID,
        sku: 'NB-001',
        marketplace: 'SHOPEE',
        status: 'PENDING',
        externalListingId: null,
        price: 4500,
        stock: 2,
        failureReason: null,
        attempts: 0,
        updatedAt: CREATED_AT,
      });
      expect(listing.id.value).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('records no event while it waits for the marketplace', () => {
      expect(pending().pullDomainEvents()).toEqual([]);
    });

    it('gets an id of its own each time', () => {
      expect(pending().id.equals(pending().id)).toBe(false);
    });

    it.each([
      ['a negative price', { price: -0.01 }, 'price of a listing must not be negative'],
      ['a price that is not a number', { price: Number.NaN }, 'price of a listing must not be negative'],
      ['a negative stock', { stock: -1 }, 'stock of a listing must be an integer'],
      ['a fractional stock', { stock: 1.5 }, 'stock of a listing must be an integer'],
      ['an empty SKU', { sku: ' ' }, 'The SKU must not be empty'],
    ])('refuses %s', (_case, overrides, message) => {
      const create = () => pending(overrides);

      expect(create).toThrow(InvalidListingError);
      expect(create).toThrow(ValidationError);
      expect(create).toThrow(message);
    });

    it('accepts a price of zero and a stock of zero', () => {
      expect(() => pending({ price: 0, stock: 0 })).not.toThrow();
    });
  });

  describe('markPublished', () => {
    it('keeps the id the marketplace gave and records ListingPublished, keyed by the product', () => {
      const listing = pending();

      listing.markPublished('MLB123', LATER);

      expect(listing).toMatchObject({ status: 'PUBLISHED', externalListingId: 'MLB123', failureReason: null, updatedAt: LATER });
      const [event, ...others] = listing.pullDomainEvents();
      expect(others).toEqual([]);
      expect(event).toBeInstanceOf(ListingPublished);
      expect(event).toMatchObject({
        aggregateId: PRODUCT_ID,
        sku: 'NB-001',
        marketplace: 'SHOPEE',
        externalListingId: 'MLB123',
        publishedAt: LATER,
      });
    });

    it('needs the id the marketplace gave', () => {
      expect(() => pending().markPublished(' ', LATER)).toThrow(InvalidListingError);
    });

    it.each(['published', 'failed'] as const)('is not possible once the listing is %s', state => {
      const listing = pending();
      if (state === 'published') listing.markPublished('MLB123', LATER);
      else listing.markFailed('HTTP 503', 3, LATER);

      const again = () => listing.markPublished('MLB456', LATER);

      expect(again).toThrow(InvalidListingTransitionError);
      expect(again).toThrow(ConflictError);
    });
  });

  describe('markFailed', () => {
    it('keeps the reason and the attempts and records ListingFailed, keyed by the product', () => {
      const listing = pending();

      listing.markFailed('HTTP 503', 3, LATER);

      expect(listing).toMatchObject({ status: 'FAILED', failureReason: 'HTTP 503', attempts: 3, externalListingId: null, updatedAt: LATER });
      const [event, ...others] = listing.pullDomainEvents();
      expect(others).toEqual([]);
      expect(event).toBeInstanceOf(ListingFailed);
      expect(event).toMatchObject({ aggregateId: PRODUCT_ID, sku: 'NB-001', marketplace: 'SHOPEE', reason: 'HTTP 503', attempts: 3 });
    });

    it('accepts no attempt at all, as when the circuit was open', () => {
      expect(() => pending().markFailed('Circuit open for SHOPEE', 0, LATER)).not.toThrow();
    });

    it('refuses attempts that are not a whole number', () => {
      expect(() => pending().markFailed('x', 1.5, LATER)).toThrow(InvalidListingError);
      expect(() => pending().markFailed('x', -1, LATER)).toThrow(InvalidListingError);
    });

    it('is not possible once the listing is published', () => {
      const listing = pending();
      listing.markPublished('MLB123', LATER);

      expect(() => listing.markFailed('HTTP 503', 3, LATER)).toThrow(InvalidListingTransitionError);
    });
  });

  describe('restart', () => {
    it('puts a failed listing back to pending, with the data of the product as it is now', () => {
      const listing = pending();
      listing.markFailed('HTTP 503', 3, LATER);
      listing.pullDomainEvents();
      const again = new Date('2026-10-28T14:00:00.000Z');

      listing.restart(4300, 1, again);

      expect(listing).toMatchObject({ status: 'PENDING', price: 4300, stock: 1, failureReason: null, attempts: 0, updatedAt: again });
      expect(listing.pullDomainEvents()).toEqual([]);
    });

    it('accepts a listing that stayed pending, as after a crash', () => {
      expect(() => pending().restart(10, 1, LATER)).not.toThrow();
    });

    it('is not possible for a published listing', () => {
      const listing = pending();
      listing.markPublished('MLB123', LATER);

      expect(() => listing.restart(10, 1, LATER)).toThrow(InvalidListingTransitionError);
    });

    it('can be followed by a publication', () => {
      const listing = pending();
      listing.markFailed('HTTP 503', 3, LATER);
      listing.pullDomainEvents();
      listing.restart(4500, 2, LATER);

      listing.markPublished('MLB123', LATER);

      expect(listing.status).toBe('PUBLISHED');
      expect(listing.pullDomainEvents()).toHaveLength(1);
    });
  });

  describe('restore', () => {
    const state: ListingState = {
      id: new Id('6f1c2b8e-0000-4000-8000-000000000001'),
      productId: PRODUCT_ID,
      sku: 'NB-001',
      marketplace: 'AMAZON',
      status: 'PUBLISHED',
      externalListingId: 'B0ABC',
      price: 10,
      stock: 3,
      failureReason: null,
      attempts: 0,
      updatedAt: CREATED_AT,
    };

    it('gives back the listing as it was saved, with no event to publish', () => {
      const listing = Listing.restore(state);

      expect(listing.toState()).toEqual(state);
      expect(listing.pullDomainEvents()).toEqual([]);
    });

    it('hands out a copy of the state, so the listing cannot be changed from outside', () => {
      const listing = Listing.restore(state);

      listing.toState().price = 99;

      expect(listing.price).toBe(10);
    });
  });
});
