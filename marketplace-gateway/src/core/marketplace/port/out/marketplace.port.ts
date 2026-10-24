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

export interface CancelOrderRequest {
    externalOrderId: string;
    reason?: string;
}

// Every call may fail with a MarketplaceUnavailableError (worth trying again) or a
// MarketplaceRejectedError (never will succeed).
export interface MarketplacePort {
    readonly marketplace: Marketplace;

    // Paid orders not shipped yet, created since the given instant.
    fetchNewOrders(since: Date): Promise<CanonicalOrder[]>;

    cancelOrder(request: CancelOrderRequest): Promise<void>;
}
