import { Marketplace } from '../../model/marketplace';
import { OrderStatus } from '../../model/order-status';
import { OrderOutput } from './order.output';

export interface OrderFilter {
    marketplace?: Marketplace;
    status?: OrderStatus;
}

export interface PageRequest {
    limit: number;
    offset: number;
}

export interface ListOrdersPort {
    list(filter: OrderFilter, page: PageRequest): Promise<OrderOutput[]>;
}
