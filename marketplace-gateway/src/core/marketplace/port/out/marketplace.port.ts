import { Marketplace } from '../../model/marketplace';

export interface CanonicalOrderItem {
    sku: string;
    quantity: number;
    unitPrice: number;
}

// A marketplace order in the language of the rest of the system. Each adapter translates
// its marketplace's payload into this.
export interface CanonicalOrder {
    externalOrderId: string;
    items: CanonicalOrderItem[];
    total: number;
    orderedAt: Date;
}

// The data a marketplace needs to list a product.
export interface ListingDraft {
    // The id of the listing at the gateway: it goes to the marketplace as the idempotency key of the call.
    listingId: string;
    sku: string;
    name: string;
    description: string;
    price: number;
    stock: number;
}

export interface PublishedListing {
    // The id the marketplace gave the listing.
    externalListingId: string;
}

export interface StockUpdate {
    // The id the marketplace gave the listing, and the SKU, because Amazon addresses its listings by SKU.
    externalListingId: string;
    sku: string;
    // The absolute stock to advertise, never a difference. Zero makes the listing unavailable.
    stock: number;
}

export interface CancelOrderRequest {
    externalOrderId: string;
    reason?: string;
}

// Every call may fail with a MarketplaceUnavailableError (worth trying again) or a
// MarketplaceRejectedError (never will succeed).
export interface MarketplacePort {
    readonly marketplace: Marketplace;

    // Lists the product. Asking again with the same draft must not list it twice.
    publishListing(draft: ListingDraft): Promise<PublishedListing>;

    // Sets the stock of a published listing. Sending the same stock again changes nothing.
    updateStock(update: StockUpdate): Promise<void>;

    // Paid orders not shipped yet, created since the given instant.
    fetchNewOrders(since: Date): Promise<CanonicalOrder[]>;

    cancelOrder(request: CancelOrderRequest): Promise<void>;
}
