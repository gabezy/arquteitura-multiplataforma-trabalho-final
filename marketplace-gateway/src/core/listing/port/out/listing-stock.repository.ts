import { Marketplace } from '../../../marketplace/model/marketplace';

// A published listing whose marketplace does not have its stock yet.
export interface UnsyncedListing {
    id: string;
    sku: string;
    marketplace: Marketplace;
    externalListingId: string;
    stock: number;
}

// The stock of the published listings, kept apart from the listing aggregate: these changes come from events
// and from the sync loops, in parallel to each other, so each one is a single atomic change.
export interface ListingStockRepositoryPort {
    // Gives the new stock to the published listings of the SKU that advertise another one, and marks them as not
    // sent yet. Answers how many changed.
    recordStock(sku: string, stock: number, now: Date): Promise<number>;

    // The published listings of the marketplace that are not sent yet, the oldest change first.
    findUnsynced(marketplace: Marketplace, limit: number): Promise<UnsyncedListing[]>;

    // Marks the stock as sent, unless a newer one was recorded while it was on its way. Answers whether it did.
    markSynced(id: string, stock: number): Promise<boolean>;
}
