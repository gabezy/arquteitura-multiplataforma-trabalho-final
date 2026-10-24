import { MarketplaceRegistry } from '../marketplace/marketplace.registry';
import { Marketplace } from '../marketplace/model/marketplace';
import {
    CircuitOpenError,
    MarketplaceRejectedError,
    MarketplaceUnavailableError,
} from '../marketplace/model/marketplace.errors';
import { MarketplacePort } from '../marketplace/port/out/marketplace.port';
import { InvalidListingError } from './model/listing.errors';
import { ListingStockRepositoryPort, UnsyncedListing } from './port/out/listing-stock.repository';
import { StockFacade } from './stock.facade';

const NOW = new Date('2026-10-28T13:00:00.000Z');
const BATCH_SIZE = 50;

const portOf = (marketplace: Marketplace): jest.Mocked<MarketplacePort> => ({
    marketplace,
    publishListing: jest.fn(),
    updateStock: jest.fn().mockResolvedValue(undefined),
    updatePrice: jest.fn().mockResolvedValue(undefined),
    fetchNewOrders: jest.fn(),
    cancelOrder: jest.fn(),
} as any);

const unsynced = (overrides: Partial<UnsyncedListing> = {}): UnsyncedListing => ({
    id: 'listing-1',
    sku: 'NB-001',
    marketplace: 'SHOPEE',
    externalListingId: '412525791',
    stock: 1,
    ...overrides,
});

describe('StockFacade', () => {
    let ports: Record<Marketplace, jest.Mocked<MarketplacePort>>;
    let stocks: jest.Mocked<ListingStockRepositoryPort>;
    let facade: StockFacade;

    beforeEach(() => {
        ports = { AMAZON: portOf('AMAZON'), MERCADO_LIVRE: portOf('MERCADO_LIVRE'), SHOPEE: portOf('SHOPEE') };
        stocks = {
            recordStock: jest.fn().mockResolvedValue(0),
            recordPrice: jest.fn().mockResolvedValue(0),
            findUnsynced: jest.fn().mockResolvedValue([]),
            findPriceUnsynced: jest.fn().mockResolvedValue([]),
            markSynced: jest.fn().mockResolvedValue(true),
            markPriceSynced: jest.fn().mockResolvedValue(true),
        } as any;
        facade = new StockFacade(new MarketplaceRegistry(Object.values(ports)), stocks, BATCH_SIZE, BATCH_SIZE, () => NOW);
    });

    describe('record', () => {
        it('gives the stock to the repository, with the SKU in capitals and the time of the change', async () => {
            await facade.record({ sku: ' nb-001 ', stock: 3 });

            expect(stocks.recordStock).toHaveBeenCalledWith('NB-001', 3, NOW);
        });

        it('answers how many listings changed', async () => {
            stocks.recordStock.mockResolvedValue(3);

            await expect(facade.record({ sku: 'NB-001', stock: 3 })).resolves.toBe(3);
        });

        it('accepts a stock of zero, which makes the listings unavailable', async () => {
            await facade.record({ sku: 'NB-001', stock: 0 });

            expect(stocks.recordStock).toHaveBeenCalledWith('NB-001', 0, NOW);
        });

        it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('refuses a stock of %p, which is not a whole number of zero or more', async stock => {
            await expect(facade.record({ sku: 'NB-001', stock })).rejects.toThrow(InvalidListingError);

            expect(stocks.recordStock).not.toHaveBeenCalled();
        });

        it('refuses a SKU that is empty', async () => {
            await expect(facade.record({ sku: '  ', stock: 1 })).rejects.toThrow('SKU');

            expect(stocks.recordStock).not.toHaveBeenCalled();
        });

        it('calls no marketplace, so one that is down never holds back the events', async () => {
            await facade.record({ sku: 'NB-001', stock: 3 });

            for (const port of Object.values(ports)) expect(port.updateStock).not.toHaveBeenCalled();
        });
    });

    describe('sync', () => {
        it('asks for the listings of the marketplace that are not sent yet, up to the size of the batch', async () => {
            await facade.sync({ marketplace: 'SHOPEE' });

            expect(stocks.findUnsynced).toHaveBeenCalledWith('SHOPEE', BATCH_SIZE);
        });

        it('does nothing when every listing of the marketplace is sent', async () => {
            await expect(facade.sync({ marketplace: 'SHOPEE' })).resolves.toEqual({ pending: 0, synced: 0, failures: [] });

            for (const port of Object.values(ports)) expect(port.updateStock).not.toHaveBeenCalled();
        });

        it('sends each listing the stock it has, with the id the marketplace gave it and its SKU, at its own marketplace', async () => {
            stocks.findUnsynced.mockResolvedValue([unsynced(), unsynced({ id: 'listing-2', sku: 'MOUSE-1', externalListingId: '99', stock: 7 })]);

            await facade.sync({ marketplace: 'SHOPEE' });

            expect(ports.SHOPEE.updateStock.mock.calls).toEqual([
                [{ externalListingId: '412525791', sku: 'NB-001', stock: 1 }],
                [{ externalListingId: '99', sku: 'MOUSE-1', stock: 7 }],
            ]);
            expect(ports.AMAZON.updateStock).not.toHaveBeenCalled();
            expect(ports.MERCADO_LIVRE.updateStock).not.toHaveBeenCalled();
        });

        it('sends the stock of zero as it is', async () => {
            stocks.findUnsynced.mockResolvedValue([unsynced({ marketplace: 'AMAZON', stock: 0 })]);

            await facade.sync({ marketplace: 'AMAZON' });

            expect(ports.AMAZON.updateStock).toHaveBeenCalledWith(expect.objectContaining({ stock: 0 }));
        });

        it('marks each listing as sent, with the stock that went to the marketplace', async () => {
            stocks.findUnsynced.mockResolvedValue([unsynced(), unsynced({ id: 'listing-2', stock: 7 })]);

            const result = await facade.sync({ marketplace: 'SHOPEE' });

            expect(stocks.markSynced.mock.calls).toEqual([['listing-1', 1], ['listing-2', 7]]);
            expect(result).toEqual({ pending: 2, synced: 2, failures: [] });
        });

        it('sends the listings at the same time, not one after the other', async () => {
            stocks.findUnsynced.mockResolvedValue([unsynced(), unsynced({ id: 'listing-2' })]);
            const releases: (() => void)[] = [];
            ports.SHOPEE.updateStock.mockImplementation(() => new Promise(resolve => releases.push(() => resolve())));

            const syncing = facade.sync({ marketplace: 'SHOPEE' });
            await new Promise(resolve => setImmediate(resolve));

            expect(releases).toHaveLength(2);
            releases.forEach(release => release());
            await syncing;
        });

        it.each([
            ['unavailable after the attempts', new MarketplaceUnavailableError('HTTP 503', 'SHOPEE', 3), 3, 'HTTP 503'],
            ['unreachable because its circuit is open', new CircuitOpenError('SHOPEE'), 0, 'Circuit open for SHOPEE'],
            ['refusing the stock', new MarketplaceRejectedError('error_item_not_found: Item not found', 'SHOPEE', 1), 1, 'error_item_not_found: Item not found'],
        ])('leaves the listing pending, and says why, when the marketplace is %s', async (_case, error, attempts, reason) => {
            stocks.findUnsynced.mockResolvedValue([unsynced()]);
            ports.SHOPEE.updateStock.mockRejectedValue(error);

            const result = await facade.sync({ marketplace: 'SHOPEE' });

            expect(stocks.markSynced).not.toHaveBeenCalled();
            expect(result).toEqual({ pending: 1, synced: 0, failures: [{ listingId: 'listing-1', sku: 'NB-001', attempts, reason }] });
        });

        it('sends the other listings when one fails', async () => {
            stocks.findUnsynced.mockResolvedValue([unsynced(), unsynced({ id: 'listing-2', sku: 'MOUSE-1', externalListingId: '99' })]);
            ports.SHOPEE.updateStock
                .mockRejectedValueOnce(new MarketplaceUnavailableError('HTTP 503', 'SHOPEE', 3))
                .mockResolvedValueOnce();

            const result = await facade.sync({ marketplace: 'SHOPEE' });

            expect(stocks.markSynced.mock.calls).toEqual([['listing-2', 1]]);
            expect(result).toMatchObject({ pending: 2, synced: 1, failures: [{ listingId: 'listing-1' }] });
        });

        it('counts as sent a stock that a newer one replaced while it was on its way, which stays pending', async () => {
            stocks.findUnsynced.mockResolvedValue([unsynced()]);
            stocks.markSynced.mockResolvedValue(false);

            await expect(facade.sync({ marketplace: 'SHOPEE' })).resolves.toEqual({ pending: 1, synced: 1, failures: [] });
        });

        it('rejects with an error that is not the marketplace\'s, after sending the other listings', async () => {
            stocks.findUnsynced.mockResolvedValue([unsynced(), unsynced({ id: 'listing-2' })]);
            stocks.markSynced.mockRejectedValueOnce(new Error('database down')).mockResolvedValueOnce(true);

            await expect(facade.sync({ marketplace: 'SHOPEE' })).rejects.toThrow('database down');

            expect(ports.SHOPEE.updateStock).toHaveBeenCalledTimes(2);
        });

        it('rejects when the listings cannot be read, so the next round tries again', async () => {
            stocks.findUnsynced.mockRejectedValue(new Error('database down'));

            await expect(facade.sync({ marketplace: 'SHOPEE' })).rejects.toThrow('database down');
        });
    });
});
