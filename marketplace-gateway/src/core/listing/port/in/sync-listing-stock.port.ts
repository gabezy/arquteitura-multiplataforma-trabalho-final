import { Marketplace } from '../../../marketplace/model/marketplace';

export interface SyncListingStockInput {
    marketplace: Marketplace;
}

export interface StockSyncFailure {
    listingId: string;
    sku: string;
    // Calls made to the marketplace; zero when its circuit was open.
    attempts: number;
    reason: string;
}

export interface StockSyncResult {
    // Listings of the marketplace whose stock was not sent yet, and how many of them the marketplace accepted.
    pending: number;
    synced: number;
    failures: StockSyncFailure[];
}

export interface SyncListingStockPort {
    // Sends to the marketplace the stock of the published listings that have not got it yet. A listing that
    // fails stays pending for the next round, and never keeps the others from being sent.
    sync(input: SyncListingStockInput): Promise<StockSyncResult>;
}
