import { MarketplaceRegistry } from '../marketplace/marketplace.registry';
import { Marketplace } from '../marketplace/model/marketplace';
import {
    CircuitOpenError,
    MarketplaceRejectedError,
    MarketplaceUnavailableError,
} from '../marketplace/model/marketplace.errors';
import { MarketplacePort } from '../marketplace/port/out/marketplace.port';
import { DomainEvent } from '../shared/domain/domain.event';
import { Listing } from './model/listing.entity';
import { InvalidListingError, ListingNotFoundError, ProductNotApprovedError, ProductNotFoundError } from './model/listing.errors';
import { ListingFailed, ListingPublished } from './model/listing.events';
import { ListingFacade } from './listing.facade';
import { ListingView } from './port/in/find-listings.port';
import { ListingReadRepositoryPort } from './port/out/listing-read.repository';
import { ListingRepositoryPort } from './port/out/listing.repository';
import { CatalogProduct, ProductCatalogPort } from './port/out/product-catalog.port';

const PRODUCT_ID = '0b8f2c1e-6a4d-4d1e-9a51-3f0f1b2c7d10';
const NOW = new Date('2026-10-28T13:00:00.000Z');
const MARKETPLACES: Marketplace[] = ['AMAZON', 'MERCADO_LIVRE', 'SHOPEE'];

const PRODUCT: CatalogProduct = { sku: 'NB-001', name: 'Notebook', description: 'Notebook 16GB RAM', price: 4500, stock: 2 };

// Keeps the listings the way the database would, and records, in order, what each save wrote.
class InMemoryListings implements ListingRepositoryPort {
    readonly rows = new Map<string, Listing>();
    readonly saves: { marketplace: Marketplace; status: string }[] = [];
    readonly events: DomainEvent[] = [];

    async findBySku(sku: string): Promise<Listing[]> {
        return [...this.rows.values()].filter(listing => listing.sku === sku).map(listing => Listing.restore(listing.toState()));
    }

    async save(listing: Listing): Promise<void> {
        this.rows.set(listing.id.value, Listing.restore(listing.toState()));
        this.saves.push({ marketplace: listing.marketplace, status: listing.status });
        this.events.push(...listing.pullDomainEvents());
    }

    statusAt(marketplace: Marketplace): string | undefined {
        return [...this.rows.values()].find(listing => listing.marketplace === marketplace)?.status;
    }

    add(listing: Listing): void {
        this.rows.set(listing.id.value, listing);
    }
}

const portOf = (marketplace: Marketplace): jest.Mocked<MarketplacePort> => ({
    marketplace,
    publishListing: jest.fn(),
    updateStock: jest.fn(),
    fetchNewOrders: jest.fn(),
    cancelOrder: jest.fn(),
});

describe('ListingFacade', () => {
    let ports: Record<Marketplace, jest.Mocked<MarketplacePort>>;
    let listings: InMemoryListings;
    let catalog: jest.Mocked<ProductCatalogPort>;
    let reader: jest.Mocked<ListingReadRepositoryPort>;
    let facade: ListingFacade;

    const existing = (marketplace: Marketplace, state: 'PUBLISHED' | 'FAILED' | 'PENDING'): Listing => {
        const listing = Listing.pending({ productId: PRODUCT_ID, sku: 'NB-001', marketplace, price: 1, stock: 1 }, NOW);
        if (state === 'PUBLISHED') listing.markPublished(`EXT-${marketplace}`, NOW);
        if (state === 'FAILED') listing.markFailed('HTTP 503', 3, NOW);
        listing.pullDomainEvents();
        return listing;
    };

    beforeEach(() => {
        ports = { AMAZON: portOf('AMAZON'), MERCADO_LIVRE: portOf('MERCADO_LIVRE'), SHOPEE: portOf('SHOPEE') };
        for (const marketplace of MARKETPLACES) {
            ports[marketplace].publishListing.mockResolvedValue({ externalListingId: `EXT-${marketplace}` });
        }
        listings = new InMemoryListings();
        catalog = { findBySku: jest.fn().mockResolvedValue(PRODUCT) };
        reader = { find: jest.fn().mockResolvedValue([]), findById: jest.fn() };
        facade = new ListingFacade(new MarketplaceRegistry(Object.values(ports)), listings, reader, catalog, () => NOW);
    });

    describe('publish', () => {
        it('reads the product from the catalog once, by its SKU in capitals', async () => {
            await facade.publish({ productId: PRODUCT_ID, sku: 'nb-001' });

            expect(catalog.findBySku).toHaveBeenCalledTimes(1);
            expect(catalog.findBySku).toHaveBeenCalledWith('NB-001');
        });

        it('lists the product at the three marketplaces, each with the draft of the product and the id of its listing', async () => {
            await facade.publish({ productId: PRODUCT_ID, sku: 'NB-001' });

            for (const marketplace of MARKETPLACES) {
                const listing = [...listings.rows.values()].find(row => row.marketplace === marketplace) as Listing;
                expect(ports[marketplace].publishListing).toHaveBeenCalledTimes(1);
                expect(ports[marketplace].publishListing).toHaveBeenCalledWith({
                    listingId: listing.id.value,
                    sku: 'NB-001',
                    name: 'Notebook',
                    description: 'Notebook 16GB RAM',
                    price: 4500,
                    stock: 2,
                });
            }
        });

        it('calls the three marketplaces at the same time, not one after the other', async () => {
            const releases: (() => void)[] = [];
            for (const marketplace of MARKETPLACES) {
                ports[marketplace].publishListing.mockImplementation(
                    () => new Promise(resolve => releases.push(() => resolve({ externalListingId: `EXT-${marketplace}` }))),
                );
            }

            const publishing = facade.publish({ productId: PRODUCT_ID, sku: 'NB-001' });
            await new Promise(resolve => setImmediate(resolve));

            expect(releases).toHaveLength(3);
            releases.forEach(release => release());
            await publishing;
        });

        it('saves each listing as PENDING before it calls its marketplace, so the API shows it is on its way', async () => {
            const seenWhileCalling: Record<string, string | undefined> = {};
            for (const marketplace of MARKETPLACES) {
                ports[marketplace].publishListing.mockImplementation(async () => {
                    seenWhileCalling[marketplace] = listings.statusAt(marketplace);
                    return { externalListingId: `EXT-${marketplace}` };
                });
            }

            await facade.publish({ productId: PRODUCT_ID, sku: 'NB-001' });

            expect(seenWhileCalling).toEqual({ AMAZON: 'PENDING', MERCADO_LIVRE: 'PENDING', SHOPEE: 'PENDING' });
        });

        it('ends each listing PUBLISHED with the id the marketplace gave, and publishes ListingPublished keyed by the product', async () => {
            await facade.publish({ productId: PRODUCT_ID, sku: 'NB-001' });

            for (const marketplace of MARKETPLACES) {
                const listing = [...listings.rows.values()].find(row => row.marketplace === marketplace) as Listing;
                expect(listing).toMatchObject({ status: 'PUBLISHED', externalListingId: `EXT-${marketplace}`, price: 4500, stock: 2, updatedAt: NOW });
            }
            expect(listings.events).toHaveLength(3);
            expect(listings.events.every(event => event instanceof ListingPublished && event.aggregateId === PRODUCT_ID)).toBe(true);
            expect(listings.events.map(event => (event as ListingPublished).marketplace).sort()).toEqual(MARKETPLACES);
        });

        it.each([
            ['is unavailable after its attempts', new MarketplaceUnavailableError('HTTP 503', 'SHOPEE', 3), 'HTTP 503', 3],
            ['refuses the listing', new MarketplaceRejectedError('HTTP 400: list_price must be greater than zero', 'SHOPEE', 1), 'HTTP 400: list_price must be greater than zero', 1],
            ['has its circuit open', new CircuitOpenError('SHOPEE'), 'Circuit open for SHOPEE', 0],
        ])('ends the listing FAILED, with the reason and the attempts, when its marketplace %s', async (_case, error, reason, attempts) => {
            ports.SHOPEE.publishListing.mockRejectedValue(error);

            await expect(facade.publish({ productId: PRODUCT_ID, sku: 'NB-001' })).resolves.toBeUndefined();

            const failed = [...listings.rows.values()].find(row => row.marketplace === 'SHOPEE') as Listing;
            expect(failed).toMatchObject({ status: 'FAILED', failureReason: reason, attempts, externalListingId: null });
            const failure = listings.events.find(event => event instanceof ListingFailed) as ListingFailed;
            expect(failure).toMatchObject({ aggregateId: PRODUCT_ID, sku: 'NB-001', marketplace: 'SHOPEE', reason, attempts });
        });

        it('publishes at the other marketplaces when one fails', async () => {
            ports.SHOPEE.publishListing.mockRejectedValue(new MarketplaceUnavailableError('HTTP 503', 'SHOPEE', 3));

            await facade.publish({ productId: PRODUCT_ID, sku: 'NB-001' });

            expect(listings.statusAt('AMAZON')).toBe('PUBLISHED');
            expect(listings.statusAt('MERCADO_LIVRE')).toBe('PUBLISHED');
            expect(listings.statusAt('SHOPEE')).toBe('FAILED');
            expect(listings.events.filter(event => event instanceof ListingPublished)).toHaveLength(2);
            expect(listings.events.filter(event => event instanceof ListingFailed)).toHaveLength(1);
        });

        it('does nothing, not even reading the catalog, when every marketplace already has the listing published', async () => {
            for (const marketplace of MARKETPLACES) listings.add(existing(marketplace, 'PUBLISHED'));

            await facade.publish({ productId: PRODUCT_ID, sku: 'NB-001' });

            expect(catalog.findBySku).not.toHaveBeenCalled();
            for (const marketplace of MARKETPLACES) expect(ports[marketplace].publishListing).not.toHaveBeenCalled();
            expect(listings.saves).toEqual([]);
        });

        it('publishes only where the listing is not published yet, and leaves the published one alone', async () => {
            const published = existing('AMAZON', 'PUBLISHED');
            listings.add(published);

            await facade.publish({ productId: PRODUCT_ID, sku: 'NB-001' });

            expect(ports.AMAZON.publishListing).not.toHaveBeenCalled();
            expect(ports.MERCADO_LIVRE.publishListing).toHaveBeenCalledTimes(1);
            expect(ports.SHOPEE.publishListing).toHaveBeenCalledTimes(1);
            expect(listings.rows.get(published.id.value)).toMatchObject({ status: 'PUBLISHED', externalListingId: 'EXT-AMAZON' });
            expect(listings.saves.some(save => save.marketplace === 'AMAZON')).toBe(false);
        });

        it('tries again a failed listing, keeping its id, with the data of the product as it is now', async () => {
            const failed = existing('SHOPEE', 'FAILED');
            listings.add(failed);
            catalog.findBySku.mockResolvedValue({ ...PRODUCT, price: 4300, stock: 1 });

            await facade.publish({ productId: PRODUCT_ID, sku: 'NB-001' });

            const retried = listings.rows.get(failed.id.value) as Listing;
            expect(retried).toMatchObject({ status: 'PUBLISHED', externalListingId: 'EXT-SHOPEE', price: 4300, stock: 1, failureReason: null, attempts: 0 });
            expect(ports.SHOPEE.publishListing).toHaveBeenCalledWith(expect.objectContaining({ listingId: failed.id.value, price: 4300, stock: 1 }));
            expect([...listings.rows.values()].filter(row => row.marketplace === 'SHOPEE')).toHaveLength(1);
        });

        it('tries again a listing that stayed pending, as after a crash', async () => {
            listings.add(existing('MERCADO_LIVRE', 'PENDING'));

            await facade.publish({ productId: PRODUCT_ID, sku: 'NB-001' });

            expect(listings.statusAt('MERCADO_LIVRE')).toBe('PUBLISHED');
        });

        it.each([
            ['the product does not exist', new ProductNotFoundError('NB-001')],
            ['the product is not approved', new ProductNotApprovedError('NB-001', 'REJECTED')],
            ['the catalog does not answer', new Error('The catalog did not answer within 3000 ms')],
        ])('saves nothing and calls no marketplace when %s', async (_case, error) => {
            catalog.findBySku.mockRejectedValue(error);

            await expect(facade.publish({ productId: PRODUCT_ID, sku: 'NB-001' })).rejects.toBe(error);

            expect(listings.saves).toEqual([]);
            for (const marketplace of MARKETPLACES) expect(ports[marketplace].publishListing).not.toHaveBeenCalled();
        });

        it('refuses a SKU that is empty', async () => {
            await expect(facade.publish({ productId: PRODUCT_ID, sku: '  ' })).rejects.toThrow(InvalidListingError);
        });

        it('rejects with an error that is not the marketplace\'s, after the other marketplaces finish', async () => {
            const bug = new TypeError('bug');
            ports.AMAZON.publishListing.mockRejectedValue(bug);

            await expect(facade.publish({ productId: PRODUCT_ID, sku: 'NB-001' })).rejects.toBe(bug);

            expect(listings.statusAt('MERCADO_LIVRE')).toBe('PUBLISHED');
            expect(listings.statusAt('SHOPEE')).toBe('PUBLISHED');
        });

        it('rejects when a listing cannot be saved, so the message is delivered again', async () => {
            jest.spyOn(listings, 'save').mockRejectedValue(new Error('database down'));

            await expect(facade.publish({ productId: PRODUCT_ID, sku: 'NB-001' })).rejects.toThrow('database down');
        });
    });

    describe('find', () => {
        const view = (overrides: Partial<ListingView> = {}): ListingView => ({
            id: '6f1c2b8e-0000-4000-8000-000000000001',
            sku: 'NB-001',
            marketplace: 'AMAZON',
            externalListingId: 'B0ABC',
            status: 'PUBLISHED',
            price: 4500,
            stock: 2,
            failureReason: null,
            updatedAt: NOW,
            ...overrides,
        });

        it('lists what the repository finds, with the limit and the offset that were asked', async () => {
            reader.find.mockResolvedValue([view()]);

            await expect(facade.find({ limit: 20, offset: 40 })).resolves.toEqual({ listings: [view()], limit: 20, offset: 40 });
            expect(reader.find).toHaveBeenCalledWith({ limit: 20, offset: 40 });
        });

        it('passes the filters on, with the SKU in capitals', async () => {
            await facade.find({ sku: ' nb-001', marketplace: 'SHOPEE', status: 'FAILED', limit: 5, offset: 0 });

            expect(reader.find).toHaveBeenCalledWith({ sku: 'NB-001', marketplace: 'SHOPEE', status: 'FAILED', limit: 5, offset: 0 });
        });

        it('finds a listing by its id', async () => {
            reader.findById.mockResolvedValue(view());

            await expect(facade.findById('6f1c2b8e-0000-4000-8000-000000000001')).resolves.toEqual(view());
        });

        it('fails with not found when there is no listing with that id', async () => {
            reader.findById.mockResolvedValue(null);

            await expect(facade.findById('6f1c2b8e-0000-4000-8000-000000000002')).rejects.toThrow(ListingNotFoundError);
            await expect(facade.findById('6f1c2b8e-0000-4000-8000-000000000002')).rejects.toThrow('Listing 6f1c2b8e-0000-4000-8000-000000000002 not found.');
        });
    });
});
