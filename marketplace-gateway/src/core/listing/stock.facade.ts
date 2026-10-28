import { MarketplaceRegistry } from '../marketplace/marketplace.registry';
import { MarketplaceError } from '../marketplace/model/marketplace.errors';
import { InvalidListingError } from './model/listing.errors';
import { normalizeSku } from './model/sku';
import { RecordProductPriceInput, RecordProductPricePort } from './port/in/record-product-price.port';
import { RecordProductStockInput, RecordProductStockPort } from './port/in/record-product-stock.port';
import {
    PriceSyncFailure,
    PriceSyncResult,
    SyncListingPriceInput,
    SyncListingPricePort,
} from './port/in/sync-listing-price.port';
import {
    StockSyncFailure,
    StockSyncResult,
    SyncListingStockInput,
    SyncListingStockPort,
} from './port/in/sync-listing-stock.port';
import { ListingStockRepositoryPort, UnsyncedListing, UnsyncedPriceListing } from './port/out/listing-stock.repository';

function roundMoney(value: number): number {
    const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
    return Number(rounded.toFixed(2));
}

export class StockFacade implements RecordProductStockPort, RecordProductPricePort, SyncListingStockPort, SyncListingPricePort {

    constructor(
        private readonly marketplaces: MarketplaceRegistry,
        private readonly stocks: ListingStockRepositoryPort,
        private readonly batchSize: number,
        private readonly priceBatchSize: number = batchSize,
        private readonly now: () => Date = () => new Date(),
    ) {}

    // Only records: no marketplace is called here, so one that is down never holds back the events.
    async record(input: RecordProductStockInput | RecordProductPriceInput): Promise<number> {
        if ('stock' in input) {
            if (!Number.isInteger(input.stock) || input.stock < 0) {
                throw new InvalidListingError('The stock of a listing must be an integer that is not negative.');
            }
            return this.stocks.recordStock(normalizeSku(input.sku), input.stock, this.now());
        }
        if ('price' in input) {
            if (!Number.isFinite(input.price) || input.price < 0) {
                throw new InvalidListingError('The price of a listing must not be negative.');
            }
            return this.stocks.recordPrice(normalizeSku(input.sku), roundMoney(input.price), this.now());
        }
        throw new InvalidListingError('Invalid record input.');
    }

    async recordPrice({ sku, price }: RecordProductPriceInput): Promise<number> {
        if (!Number.isFinite(price) || price < 0) {
            throw new InvalidListingError('The price of a listing must not be negative.');
        }

        return this.stocks.recordPrice(normalizeSku(sku), roundMoney(price), this.now());
    }

    async sync({ marketplace }: SyncListingStockInput): Promise<StockSyncResult> {
        const unsynced = await this.stocks.findUnsynced(marketplace, this.batchSize);
        const outcomes = await Promise.allSettled(unsynced.map(listing => this.send(listing)));

        const unexpected = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
        if (unexpected) {
            throw unexpected.reason;
        }

        const failures = outcomes.flatMap(outcome => (outcome.status === 'fulfilled' && outcome.value ? [outcome.value] : []));

        return { pending: unsynced.length, synced: unsynced.length - failures.length, failures };
    }

    async syncPrice({ marketplace }: SyncListingPriceInput): Promise<PriceSyncResult> {
        const unsynced = await this.stocks.findPriceUnsynced(marketplace, this.priceBatchSize);
        const outcomes = await Promise.allSettled(unsynced.map(listing => this.sendPrice(listing)));

        const unexpected = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
        if (unexpected) {
            throw unexpected.reason;
        }

        const failures = outcomes.flatMap(outcome => (outcome.status === 'fulfilled' && outcome.value ? [outcome.value] : []));

        return { pending: unsynced.length, synced: unsynced.length - failures.length, failures };
    }

    // The stock goes as it was when the listing was read: if a newer one is recorded meanwhile, the listing
    // stays pending and the next round sends that one.
    private async send(listing: UnsyncedListing): Promise<StockSyncFailure | undefined> {
        try {
            await this.marketplaces.get(listing.marketplace).updateStock({
                externalListingId: listing.externalListingId,
                sku: listing.sku,
                stock: listing.stock,
            });
        } catch (err) {
            if (!(err instanceof MarketplaceError)) {
                throw err;
            }
            return { listingId: listing.id, sku: listing.sku, attempts: err.attempts, reason: err.message };
        }

        await this.stocks.markSynced(listing.id, listing.stock);
        return undefined;
    }

    private async sendPrice(listing: UnsyncedPriceListing): Promise<PriceSyncFailure | undefined> {
        try {
            await this.marketplaces.get(listing.marketplace).updatePrice({
                externalListingId: listing.externalListingId,
                sku: listing.sku,
                price: roundMoney(listing.price),
            });
        } catch (err) {
            if (!(err instanceof MarketplaceError)) {
                throw err;
            }
            return { listingId: listing.id, sku: listing.sku, attempts: err.attempts, reason: err.message };
        }

        await this.stocks.markPriceSynced(listing.id, roundMoney(listing.price));
        return undefined;
    }

}
