import { Marketplace } from '../../../marketplace/model/marketplace';

export interface SyncListingPriceInput {
    marketplace: Marketplace;
}

export interface PriceSyncFailure {
    listingId: string;
    sku: string;
    // Calls made to the marketplace; zero when its circuit was open.
    attempts: number;
    reason: string;
}

export interface PriceSyncResult {
    // Listings of the marketplace whose price was not sent yet, and how many of them the marketplace accepted.
    pending: number;
    synced: number;
    failures: PriceSyncFailure[];
}

export interface SyncListingPricePort {
    // Sends to the marketplace the price of the published listings that have not got it yet. A listing that
    // fails stays pending for the next round, and never keeps the others from being sent.
    sync(input: SyncListingPriceInput): Promise<PriceSyncResult>;
}
