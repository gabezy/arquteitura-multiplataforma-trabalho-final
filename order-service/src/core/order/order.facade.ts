import { Order } from './model/order.entity';
import { OrderNotFoundError } from './model/order.errors';
import { GetOrderPort } from './port/in/get-order.port';
import { ListOrdersPort, OrderFilter, PageRequest } from './port/in/list-orders.port';
import { OrderOutput } from './port/in/order.output';
import { ReceiveOrderPort, ReceiveOrderPortInput, ReceiveOrderPortOutput } from './port/in/receive-order.port';
import { OrderRepositoryPort } from './port/out/order.repository';

export class OrderFacade implements ReceiveOrderPort, ListOrdersPort, GetOrderPort {

    constructor(private readonly orderRepository: OrderRepositoryPort) {}

    async receive({ eventId, ...props }: ReceiveOrderPortInput): Promise<ReceiveOrderPortOutput> {
        const order = Order.receive(props);

        const created = await this.orderRepository.saveReceived(order, eventId);

        return { outcome: created ? 'created' : 'duplicate', order: toOutput(order) };
    }

    async list(filter: OrderFilter, page: PageRequest): Promise<OrderOutput[]> {
        const orders = await this.orderRepository.list(filter, page);
        return orders.map(toOutput);
    }

    async get(id: string): Promise<OrderOutput> {
        const order = await this.orderRepository.findById(id);

        if (!order) {
            throw new OrderNotFoundError(id);
        }

        return toOutput(order);
    }

}

function toOutput(order: Order): OrderOutput {
    return {
        id: order.id.value,
        marketplace: order.marketplace,
        externalOrderId: order.externalOrderId,
        status: order.status,
        total: order.total.toReais(),
        items: order.items.map(({ sku, quantity, unitPrice }) => ({ sku, quantity, unitPrice: unitPrice.toReais() })),
        cancellationReason: order.cancellationReason,
        orderedAt: order.orderedAt,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
    };
}
