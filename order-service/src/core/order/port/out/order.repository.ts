import { Order } from '../../model/order.entity';
import { OrderFilter, PageRequest } from '../in/list-orders.port';

export interface OrderRepositoryPort {
    // Saves the order, its OrderPlaced in the outbox and the eventId in the inbox, all or nothing.
    // Returns false, saving only the eventId, when the marketplace order already exists.
    saveReceived(order: Order, eventId?: string): Promise<boolean>;
    findById(id: string): Promise<Order | null>;
    // Newest first.
    list(filter: OrderFilter, page: PageRequest): Promise<Order[]>;
}
