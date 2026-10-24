import { Marketplace } from '../../../marketplace/model/marketplace';
import { ListingStatus } from '../../model/listing-status';

export interface ListingView {
    id: string;
    sku: string;
    marketplace: Marketplace;
    externalListingId: string | null;
    status: ListingStatus;
    price: number;
    stock: number;
    failureReason: string | null;
    updatedAt: Date;
}

export interface ListingsQuery {
    sku?: string;
    marketplace?: Marketplace;
    status?: ListingStatus;
    limit: number;
    offset: number;
}

export interface ListingsPage {
    listings: ListingView[];
    limit: number;
    offset: number;
}

export interface FindListingsPort {
    find(query: ListingsQuery): Promise<ListingsPage>;

    findById(id: string): Promise<ListingView>;
}
