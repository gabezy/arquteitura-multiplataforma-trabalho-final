import { OrderOutput } from './order.output';

export interface GetOrderPort {
    // Rejects with OrderNotFoundError when there is no order with the id.
    get(id: string): Promise<OrderOutput>;
}
