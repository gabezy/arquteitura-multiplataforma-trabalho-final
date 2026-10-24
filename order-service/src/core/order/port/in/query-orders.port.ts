export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

// An order as the API shows it: money in reais as JSON numbers.
export interface OrderView {
    id: string;
    marketplace: string;
    externalOrderId: string;
    status: string;
    total: number;
    items: { sku: string; quantity: number; unitPrice: number }[];
    cancellationReason: string | null;
    // The date of the sale at the marketplace.
    createdAt: Date;
    updatedAt: Date;
}

export interface ListOrdersQuery {
    marketplace?: string;
    status?: string;
    limit?: number;
    offset?: number;
}

export interface OrderPage {
    orders: OrderView[];
    limit: number;
    offset: number;
}

export interface QueryOrdersPort {

    find(id: string): Promise<OrderView>;

    // Newest first.
    list(query: ListOrdersQuery): Promise<OrderPage>;

}
