import { Knex } from 'knex';
import { Listing } from '../../core/listing/model/listing.entity';
import { ListingStatus } from '../../core/listing/model/listing-status';
import { Marketplace } from '../../core/marketplace/model/marketplace';
import { toListingIntegrationEvent } from '../messaging/listing.integration-events';
import { createTestDatabase, TestDatabase } from '../testing/test-database';
import { KnexListingReadRepository } from './knex-listing-read.repository';
import { KnexListingStockRepository } from './knex-listing-stock.repository';
import { KnexListingRepository } from './knex-listing.repository';
import { KnexOutboxRepository } from './knex-outbox.repository';
import { createMigrationSource } from './migration-source';

const PRODUCT_ID = '0b8f2c1e-6a4d-4d1e-9a51-3f0f1b2c7d10';
const OTHER_PRODUCT_ID = '1c9a3d2f-7b5e-4e2f-8b62-4a1a2c3d8e21';
const CREATED_AT = new Date('2026-10-28T13:00:00.000Z');
const FIRST_SALE_AT = new Date('2026-10-28T14:00:00.000Z');
const SECOND_SALE_AT = new Date('2026-10-28T14:05:00.000Z');

describe('the stock repository of the listings', () => {
  let testDatabase: TestDatabase;
  let db: Knex;
  let listings: KnexListingRepository;
  let stocks: KnexListingStockRepository;

  const seed = async (marketplace: Marketplace, status: ListingStatus, sku = 'NB-001', stock = 5) => {
    const listing = Listing.pending({ productId: sku === 'NB-001' ? PRODUCT_ID : OTHER_PRODUCT_ID, sku, marketplace, price: 4500, stock }, CREATED_AT);
    if (status === 'PUBLISHED') listing.markPublished(`EXT-${sku}-${marketplace}`, CREATED_AT);
    if (status === 'FAILED') listing.markFailed('HTTP 503', 3, CREATED_AT);
    await listings.save(listing);
    return listing.id.value;
  };

  const rowOf = async (id: string) => db('listings').where({ id }).first('stock', 'stock_synced', 'updated_at');

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    db = testDatabase.db;
    await db.migrate.latest({ migrationSource: createMigrationSource() });
    listings = new KnexListingRepository(db, new KnexOutboxRepository(toListingIntegrationEvent));
    stocks = new KnexListingStockRepository(db);
  });

  afterEach(async () => {
    await db('outbox').truncate();
    await db('listings').truncate();
  });

  afterAll(async () => {
    await testDatabase?.destroy();
  });

  it('starts a new listing in sync, because the stock it was published with is the one the marketplace has', async () => {
    const id = await seed('SHOPEE', 'PUBLISHED');

    expect(await rowOf(id)).toMatchObject({ stock: 5, stock_synced: true });
  });

  describe('recordStock', () => {
    it('gives the new stock to the published listing, marks it as not sent, and moves its update time', async () => {
      const id = await seed('SHOPEE', 'PUBLISHED');

      const changed = await stocks.recordStock('NB-001', 4, FIRST_SALE_AT);

      expect(changed).toBe(1);
      expect(await rowOf(id)).toEqual({ stock: 4, stock_synced: false, updated_at: FIRST_SALE_AT });
    });

    it('changes the listing of the SKU at every marketplace, and no listing of another SKU', async () => {
      const ids = [await seed('AMAZON', 'PUBLISHED'), await seed('MERCADO_LIVRE', 'PUBLISHED'), await seed('SHOPEE', 'PUBLISHED')];
      const other = await seed('SHOPEE', 'PUBLISHED', 'MOUSE-1', 9);

      const changed = await stocks.recordStock('NB-001', 4, FIRST_SALE_AT);

      expect(changed).toBe(3);
      for (const id of ids) expect(await rowOf(id)).toMatchObject({ stock: 4, stock_synced: false });
      expect(await rowOf(other)).toMatchObject({ stock: 9, stock_synced: true });
    });

    it('records a stock of zero, which makes the listing unavailable at the marketplace', async () => {
      const id = await seed('SHOPEE', 'PUBLISHED');

      await stocks.recordStock('NB-001', 0, FIRST_SALE_AT);

      expect(await rowOf(id)).toMatchObject({ stock: 0, stock_synced: false });
    });

    it.each(['PENDING', 'FAILED'] as const)('leaves a %s listing alone, because publishing it reads the stock from the catalog', async status => {
      const id = await seed('SHOPEE', status);

      const changed = await stocks.recordStock('NB-001', 4, FIRST_SALE_AT);

      expect(changed).toBe(0);
      expect(await rowOf(id)).toEqual({ stock: 5, stock_synced: true, updated_at: CREATED_AT });
    });

    it('changes nothing when the listing already advertises that stock', async () => {
      const id = await seed('SHOPEE', 'PUBLISHED');

      const changed = await stocks.recordStock('NB-001', 5, FIRST_SALE_AT);

      expect(changed).toBe(0);
      expect(await rowOf(id)).toEqual({ stock: 5, stock_synced: true, updated_at: CREATED_AT });
    });

    it('keeps a listing that has not been sent yet waiting when the same stock is recorded again', async () => {
      const id = await seed('SHOPEE', 'PUBLISHED');
      await stocks.recordStock('NB-001', 4, FIRST_SALE_AT);

      const changed = await stocks.recordStock('NB-001', 4, SECOND_SALE_AT);

      expect(changed).toBe(0);
      expect(await rowOf(id)).toEqual({ stock: 4, stock_synced: false, updated_at: FIRST_SALE_AT });
    });

    it('does nothing for a SKU without listings', async () => {
      await expect(stocks.recordStock('NB-404', 1, FIRST_SALE_AT)).resolves.toBe(0);
    });

    it('shows the new stock, and the time of the change, in the listings API', async () => {
      const id = await seed('SHOPEE', 'PUBLISHED');
      await stocks.recordStock('NB-001', 4, FIRST_SALE_AT);

      const view = await new KnexListingReadRepository(db).findById(id);

      expect(view).toMatchObject({ stock: 4, updatedAt: FIRST_SALE_AT });
    });
  });

  describe('findUnsynced', () => {
    it('finds the published listings of the marketplace that are not sent yet, as what the sync loop needs to send them', async () => {
      const id = await seed('SHOPEE', 'PUBLISHED');
      await stocks.recordStock('NB-001', 4, FIRST_SALE_AT);

      await expect(stocks.findUnsynced('SHOPEE', 50)).resolves.toEqual([
        { id, sku: 'NB-001', marketplace: 'SHOPEE', externalListingId: 'EXT-NB-001-SHOPEE', stock: 4 },
      ]);
    });

    it('finds nothing while every listing is sent', async () => {
      await seed('SHOPEE', 'PUBLISHED');

      await expect(stocks.findUnsynced('SHOPEE', 50)).resolves.toEqual([]);
    });

    it('finds only the listings of the marketplace it is asked about', async () => {
      await seed('AMAZON', 'PUBLISHED');
      const shopee = await seed('SHOPEE', 'PUBLISHED');
      await stocks.recordStock('NB-001', 4, FIRST_SALE_AT);

      const found = await stocks.findUnsynced('SHOPEE', 50);

      expect(found.map(listing => listing.id)).toEqual([shopee]);
    });

    it('finds the oldest change first, and no more than the limit', async () => {
      const mouse = await seed('SHOPEE', 'PUBLISHED', 'MOUSE-1', 9);
      const notebook = await seed('SHOPEE', 'PUBLISHED', 'NB-001', 5);
      const keyboard = await seed('SHOPEE', 'PUBLISHED', 'KB-1', 3);
      await stocks.recordStock('NB-001', 4, FIRST_SALE_AT);
      await stocks.recordStock('MOUSE-1', 8, SECOND_SALE_AT);
      await stocks.recordStock('KB-1', 2, new Date('2026-10-28T14:10:00.000Z'));

      expect((await stocks.findUnsynced('SHOPEE', 50)).map(listing => listing.id)).toEqual([notebook, mouse, keyboard]);
      expect((await stocks.findUnsynced('SHOPEE', 2)).map(listing => listing.id)).toEqual([notebook, mouse]);
    });
  });

  describe('markSynced', () => {
    it('marks the listing as sent when the stock that went is the one it has', async () => {
      const id = await seed('SHOPEE', 'PUBLISHED');
      await stocks.recordStock('NB-001', 4, FIRST_SALE_AT);

      await expect(stocks.markSynced(id, 4)).resolves.toBe(true);

      expect(await rowOf(id)).toMatchObject({ stock: 4, stock_synced: true });
      await expect(stocks.findUnsynced('SHOPEE', 50)).resolves.toEqual([]);
    });

    it('does not change the update time, because the data of the listing did not change', async () => {
      const id = await seed('SHOPEE', 'PUBLISHED');
      await stocks.recordStock('NB-001', 4, FIRST_SALE_AT);

      await stocks.markSynced(id, 4);

      expect((await rowOf(id)).updated_at).toEqual(FIRST_SALE_AT);
    });

    it('keeps the listing waiting when a newer stock was recorded while the old one was on its way', async () => {
      const id = await seed('SHOPEE', 'PUBLISHED');
      await stocks.recordStock('NB-001', 4, FIRST_SALE_AT);
      await stocks.recordStock('NB-001', 3, SECOND_SALE_AT);

      await expect(stocks.markSynced(id, 4)).resolves.toBe(false);

      expect(await rowOf(id)).toMatchObject({ stock: 3, stock_synced: false });
      expect(await stocks.findUnsynced('SHOPEE', 50)).toMatchObject([{ id, stock: 3 }]);
    });

    it('answers false for a listing that is already sent', async () => {
      const id = await seed('SHOPEE', 'PUBLISHED');

      await expect(stocks.markSynced(id, 5)).resolves.toBe(false);
    });
  });
});
