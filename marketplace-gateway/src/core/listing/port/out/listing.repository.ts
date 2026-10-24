import { Listing } from '../../model/listing.entity';

export interface ListingRepositoryPort {
    // The listings of a product, one per marketplace that has one.
    findBySku(sku: string): Promise<Listing[]>;

    // Saves the listing and the events it recorded in one transaction.
    save(listing: Listing): Promise<void>;
}
