import { MarketplaceRegistry } from '../marketplace/marketplace.registry';
import { MarketplaceError } from '../marketplace/model/marketplace.errors';
import { InvalidListingError } from './model/listing.errors';
import { normalizeSku } from './model/sku';
import { RecordProductStockInput, RecordProductStockPort } from './port/in/record-product-stock.port';
import {
    StockSyncFailure,
    StockSyncResult,
    SyncListingStockInput,
    SyncListingStockPort,
} from './port/in/sync-listing-stock.port';
import { ListingStockRepositoryPort, UnsyncedListing } from './port/out/listing-stock.repository';

export class StockFacade implements RecordProductStockPort, SyncListingStockPort {

    constructor(
        private readonly marketplaces: MarketplaceRegistry,
        private readonly stocks: ListingStockRepositoryPort,
        private readonly batchSize: number,
        private readonly now: () => Date = () => new Date(),
    ) {}

    // Only records: no marketplace is called here, so one that is down never holds back the events.
    async record({ sku, stock }: RecordProductStockInput): Promise<number> {
        if (!Number.isInteger(stock) || stock < 0) {
            throw new InvalidListingError('The stock of a listing must be an integer that is not negative.');
        }

        return this.stocks.recordStock(normalizeSku(sku), stock, this.now());
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

}
