import { Knex } from 'knex';
import { Listing } from '../../core/listing/model/listing.entity';
import { ListingStatus } from '../../core/listing/model/listing-status';
import { Marketplace } from '../../core/marketplace/model/marketplace';
import { IntegrationEventMapper } from '../messaging/integration-event';
import { toListingIntegrationEvent } from '../messaging/listing.integration-events';
import { createTestDatabase, TestDatabase } from '../testing/test-database';
import { KnexListingReadRepository } from './knex-listing-read.repository';
import { KnexListingRepository } from './knex-listing.repository';
import { KnexOutboxRepository } from './knex-outbox.repository';
import { createMigrationSource } from './migration-source';

const PRODUCT_ID = '0b8f2c1e-6a4d-4d1e-9a51-3f0f1b2c7d10';
const OTHER_PRODUCT_ID = '1c9a3d2f-7b5e-4e2f-8b62-4a1a2c3d8e21';
const CREATED_AT = new Date('2026-10-28T13:00:00.000Z');
const LATER = new Date('2026-10-28T13:00:05.123Z');

const pending = (marketplace: Marketplace = 'SHOPEE', sku = 'NB-001', productId = PRODUCT_ID) =>
  Listing.pending({ productId, sku, marketplace, price: 4500.5, stock: 2 }, CREATED_AT);

describe('the listing repositories', () => {
  let testDatabase: TestDatabase;
  let db: Knex;
  let repository: KnexListingRepository;
  let reader: KnexListingReadRepository;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    db = testDatabase.db;
    await db.migrate.latest({ migrationSource: createMigrationSource() });
    repository = new KnexListingRepository(db, new KnexOutboxRepository(toListingIntegrationEvent));
    reader = new KnexListingReadRepository(db);
  });

  afterEach(async () => {
    await db('outbox').truncate();
    await db('listings').truncate();
  });

  afterAll(async () => {
    await testDatabase?.destroy();
  });

  describe('save', () => {
    it('inserts a new pending listing, with no event', async () => {
      const listing = pending();

      await repository.save(listing);

      expect(await db('listings').select()).toEqual([
        {
          id: listing.id.value,
          product_id: PRODUCT_ID,
          sku: 'NB-001',
          marketplace: 'SHOPEE',
          status: 'PENDING',
          external_listing_id: null,
          price: '4500.50',
          stock: 2,
          failure_reason: null,
          attempts: 0,
          created_at: expect.any(Date),
          updated_at: CREATED_AT,
        },
      ]);
      expect(await db('outbox').count({ total: '*' }).first()).toEqual({ total: '0' });
    });

    it('updates the same row when the listing is published, and writes ListingPublished in the same transaction', async () => {
      const listing = pending();
      await repository.save(listing);

      listing.markPublished('412525791', LATER);
      await repository.save(listing);

      expect(await db('listings').select('id', 'status', 'external_listing_id', 'updated_at')).toEqual([
        { id: listing.id.value, status: 'PUBLISHED', external_listing_id: '412525791', updated_at: LATER },
      ]);
      expect(await db('outbox').select('aggregate_type', 'aggregate_id', 'event_type', 'payload', 'published_at')).toEqual([
        {
          aggregate_type: 'Listing',
          aggregate_id: PRODUCT_ID,
          event_type: 'marketplace.listing.published.v1',
          payload: {
            productId: PRODUCT_ID,
            sku: 'NB-001',
            marketplace: 'SHOPEE',
            externalListingId: '412525791',
            publishedAt: '2026-10-28T13:00:05.123Z',
          },
          published_at: null,
        },
      ]);
    });

    it('stores the reason and the attempts of a failure, and writes ListingFailed keyed by the product', async () => {
      const listing = pending();
      await repository.save(listing);

      listing.markFailed('HTTP 503', 3, LATER);
      await repository.save(listing);

      expect(await db('listings').select('status', 'failure_reason', 'attempts', 'external_listing_id')).toEqual([
        { status: 'FAILED', failure_reason: 'HTTP 503', attempts: 3, external_listing_id: null },
      ]);
      expect(await db('outbox').select('aggregate_id', 'event_type', 'payload')).toEqual([
        {
          aggregate_id: PRODUCT_ID,
          event_type: 'marketplace.listing.failed.v1',
          payload: { productId: PRODUCT_ID, sku: 'NB-001', marketplace: 'SHOPEE', reason: 'HTTP 503', attempts: 3 },
        },
      ]);
    });

    it('lets a failed listing start again and end published, keeping one row', async () => {
      const listing = pending();
      listing.markFailed('HTTP 503', 3, CREATED_AT);
      await repository.save(listing);

      listing.restart(4300, 1, LATER);
      await repository.save(listing);
      listing.markPublished('412525791', LATER);
      await repository.save(listing);

      expect(await db('listings').select('status', 'price', 'stock', 'failure_reason', 'attempts')).toEqual([
        { status: 'PUBLISHED', price: '4300.00', stock: 1, failure_reason: null, attempts: 0 },
      ]);
      expect(await db('outbox').orderBy('sequence').pluck('event_type')).toEqual([
        'marketplace.listing.failed.v1',
        'marketplace.listing.published.v1',
      ]);
    });

    it('refuses a second listing of the same SKU at the same marketplace, and writes none of its events', async () => {
      await repository.save(pending('SHOPEE'));
      const duplicate = pending('SHOPEE');
      duplicate.markFailed('HTTP 503', 3, LATER);

      await expect(repository.save(duplicate)).rejects.toThrow();

      expect(await db('listings').count({ total: '*' }).first()).toEqual({ total: '1' });
      expect(await db('outbox').count({ total: '*' }).first()).toEqual({ total: '0' });
    });

    it('saves neither the change nor an event when the event cannot be recorded', async () => {
      const listing = pending();
      await repository.save(listing);
      const withoutContract: IntegrationEventMapper = event => {
        throw new Error(`No integration event for ${event.eventName}.`);
      };
      const broken = new KnexListingRepository(db, new KnexOutboxRepository(withoutContract));

      listing.markPublished('412525791', LATER);
      await expect(broken.save(listing)).rejects.toThrow('No integration event for ListingPublished.');

      expect(await db('listings').pluck('status')).toEqual(['PENDING']);
    });
  });

  describe('findBySku', () => {
    it('restores the listings of the SKU, ordered by marketplace, and no others', async () => {
      const published = pending('MERCADO_LIVRE');
      published.markPublished('MLB1', LATER);
      await repository.save(published);
      await repository.save(pending('AMAZON'));
      await repository.save(pending('AMAZON', 'MOUSE-1', OTHER_PRODUCT_ID));

      const found = await repository.findBySku('NB-001');

      expect(found.map(listing => listing.marketplace)).toEqual(['AMAZON', 'MERCADO_LIVRE']);
      expect(found[1].toState()).toEqual({
        id: published.id,
        productId: PRODUCT_ID,
        sku: 'NB-001',
        marketplace: 'MERCADO_LIVRE',
        status: 'PUBLISHED',
        externalListingId: 'MLB1',
        price: 4500.5,
        stock: 2,
        failureReason: null,
        attempts: 0,
        updatedAt: LATER,
      });
      expect(found[1].pullDomainEvents()).toEqual([]);
    });

    it('finds nothing for a SKU without listings', async () => {
      await expect(repository.findBySku('NB-404')).resolves.toEqual([]);
    });
  });

  describe('the read side', () => {
    const seed = async () => {
      const save = async (marketplace: Marketplace, sku: string, status: ListingStatus) => {
        const listing = pending(marketplace, sku, sku === 'NB-001' ? PRODUCT_ID : OTHER_PRODUCT_ID);
        if (status === 'PUBLISHED') listing.markPublished(`EXT-${sku}-${marketplace}`, LATER);
        if (status === 'FAILED') listing.markFailed('HTTP 503', 3, LATER);
        await repository.save(listing);
      };
      await save('SHOPEE', 'NB-001', 'FAILED');
      await save('AMAZON', 'NB-001', 'PUBLISHED');
      await save('MERCADO_LIVRE', 'NB-001', 'PUBLISHED');
      await save('SHOPEE', 'MOUSE-1', 'PENDING');
      await save('AMAZON', 'MOUSE-1', 'FAILED');
    };

    const find = (query: Partial<{ sku: string; marketplace: Marketplace; status: ListingStatus; limit: number; offset: number }> = {}) =>
      reader.find({ limit: 20, offset: 0, ...query });

    const keys = (views: { sku: string; marketplace: string }[]) => views.map(view => `${view.sku}/${view.marketplace}`);

    beforeEach(seed);

    it('lists every listing sorted by SKU and marketplace', async () => {
      expect(keys(await find())).toEqual([
        'MOUSE-1/AMAZON', 'MOUSE-1/SHOPEE', 'NB-001/AMAZON', 'NB-001/MERCADO_LIVRE', 'NB-001/SHOPEE',
      ]);
    });

    it('gives each listing as the view of the contract', async () => {
      const [view] = await find({ sku: 'NB-001', marketplace: 'AMAZON' });

      expect(view).toEqual({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        sku: 'NB-001',
        marketplace: 'AMAZON',
        externalListingId: 'EXT-NB-001-AMAZON',
        status: 'PUBLISHED',
        price: 4500.5,
        stock: 2,
        failureReason: null,
        updatedAt: LATER,
      });
    });

    it('gives the reason of a failure and no external id for a listing that did not make it', async () => {
      const [view] = await find({ sku: 'NB-001', marketplace: 'SHOPEE' });

      expect(view).toMatchObject({ status: 'FAILED', externalListingId: null, failureReason: 'HTTP 503' });
    });

    it.each([
      ['by SKU', { sku: 'NB-001' }, ['NB-001/AMAZON', 'NB-001/MERCADO_LIVRE', 'NB-001/SHOPEE']],
      ['by marketplace', { marketplace: 'SHOPEE' as Marketplace }, ['MOUSE-1/SHOPEE', 'NB-001/SHOPEE']],
      ['by status', { status: 'PUBLISHED' as ListingStatus }, ['NB-001/AMAZON', 'NB-001/MERCADO_LIVRE']],
      ['by SKU and status', { sku: 'MOUSE-1', status: 'FAILED' as ListingStatus }, ['MOUSE-1/AMAZON']],
      ['by the three filters', { sku: 'NB-001', marketplace: 'SHOPEE' as Marketplace, status: 'FAILED' as ListingStatus }, ['NB-001/SHOPEE']],
      ['by filters that match nothing', { sku: 'NB-001', marketplace: 'SHOPEE' as Marketplace, status: 'PUBLISHED' as ListingStatus }, []],
      ['by a SKU nobody has', { sku: 'NB-404' }, []],
    ])('filters %s', async (_case, query, expected) => {
      expect(keys(await find(query))).toEqual(expected);
    });

    it('pages through the listings without repeating or skipping any', async () => {
      const first = await find({ limit: 2, offset: 0 });
      const second = await find({ limit: 2, offset: 2 });
      const third = await find({ limit: 2, offset: 4 });
      const beyond = await find({ limit: 2, offset: 6 });

      expect(keys([...first, ...second, ...third])).toEqual([
        'MOUSE-1/AMAZON', 'MOUSE-1/SHOPEE', 'NB-001/AMAZON', 'NB-001/MERCADO_LIVRE', 'NB-001/SHOPEE',
      ]);
      expect([first.length, second.length, third.length, beyond.length]).toEqual([2, 2, 1, 0]);
    });

    it('finds a listing by its id', async () => {
      const [expected] = await find({ sku: 'NB-001', marketplace: 'MERCADO_LIVRE' });

      await expect(reader.findById(expected.id)).resolves.toEqual(expected);
    });

    it('finds nothing for an id nobody has', async () => {
      await expect(reader.findById('6f1c2b8e-0000-4000-8000-000000000099')).resolves.toBeNull();
    });
  });
});
