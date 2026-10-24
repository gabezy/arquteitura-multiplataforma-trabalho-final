import { ListingsQuery, ListingView } from '../in/find-listings.port';

export interface ListingReadRepositoryPort {
    // Sorted by SKU and marketplace, so a page does not move while listings change.
    find(query: ListingsQuery): Promise<ListingView[]>;

    findById(id: string): Promise<ListingView | null>;
}
