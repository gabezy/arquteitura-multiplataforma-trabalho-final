import { Id } from "../../../shared/domain/id";
import { Marketplace } from "../../model/marketplace.vo";
import { OrderStatus } from "../../model/order-status.vo";
import { Order } from "../../model/order.entity";

export interface OrderListFilter {
    marketplace?: Marketplace;
    status?: OrderStatus;
    limit: number;
    offset: number;
}

export interface SalesPeriod {
    fromInclusive: Date;
    toExclusive: Date;
    // Only the orders in one of these statuses count as sales.
    statuses: readonly OrderStatus[];
}

export interface MarketplaceSales {
    marketplace: string;
    orders: number;
    units: number;
    totalCents: number;
}

export interface OrderRepositoryPort {
    findById(id: Id): Promise<Order | null>;
    findByExternalId(marketplace: Marketplace, externalOrderId: string): Promise<Order | null>;
    // Saves the consumed event id, a new order and its events together. Repeated event or marketplace ids are no-ops.
    saveNew(order: Order, eventId?: string): Promise<{ orderId: string; created: boolean }>;
    // Saves the changes of an order and its events in one transaction. Fails, saving nothing, when the order
    // was changed since it was read.
    save(order: Order): Promise<void>;
    // Newest first, by the date of the sale.
    list(filter: OrderListFilter): Promise<Order[]>;
    // One row per marketplace that had sales in the period; a marketplace without sales has no row.
    salesByMarketplace(period: SalesPeriod): Promise<MarketplaceSales[]>;
}
