import { Id } from "../shared/domain/id";
import { Marketplace } from "./model/marketplace.vo";
import { OrderStatus } from "./model/order-status.vo";
import { Order } from "./model/order.entity";
import { InvalidOrderError, OrderNotFoundError } from "./model/order.errors";
import { ApplyPaymentResultPort, PaymentResultPortInput } from "./port/in/apply-payment-result.port";
import { ApplyStockOutcomePort, StockOutcomePortInput } from "./port/in/apply-stock-outcome.port";
import {
    DEFAULT_PAGE_SIZE, ListOrdersQuery, MAX_PAGE_SIZE, OrderPage, OrderView, QueryOrdersPort,
} from "./port/in/query-orders.port";
import { ReceiveOrderPort, ReceiveOrderPortInput, ReceiveOrderPortOutput } from "./port/in/receive-order.port";
import { OrderRepositoryPort } from "./port/out/order.repository";

const ORDER_ID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class OrderFacade implements ReceiveOrderPort, ApplyStockOutcomePort, ApplyPaymentResultPort, QueryOrdersPort {

    constructor(
        private readonly repository: OrderRepositoryPort,
        private readonly clock: () => Date = () => new Date()
    ) {}

    // A marketplace order that is already known is kept as it is, whatever message brings it again.
    async receive(input: ReceiveOrderPortInput): Promise<ReceiveOrderPortOutput> {
        const order = Order.receive(input, this.clock());

        const existing = await this.repository.findByExternalId(order.marketplace, order.externalOrderId);
        if (existing) {
            return { orderId: existing.id.value, created: false };
        }

        await this.repository.saveNew(order);
        return { orderId: order.id.value, created: true };
    }

    async applyStockReserved({ orderId }: StockOutcomePortInput): Promise<void> {
        await this.apply(orderId, order => order.confirm(this.clock()));
    }

    async applyStockInsufficient({ orderId }: StockOutcomePortInput): Promise<void> {
        await this.apply(orderId, order => order.cancelForStock(this.clock()));
    }

    async applyPaymentConfirmed({ orderId }: PaymentResultPortInput): Promise<void> {
        await this.apply(orderId, order => order.markPaid(this.clock()));
    }

    async applyPaymentFailed({ orderId }: PaymentResultPortInput): Promise<void> {
        await this.apply(orderId, order => order.cancelForPayment(this.clock()));
    }

    async find(id: string): Promise<OrderView> {
        return this.toView(await this.load(id));
    }

    async list(query: ListOrdersQuery): Promise<OrderPage> {
        const limit = query.limit ?? DEFAULT_PAGE_SIZE;
        const offset = query.offset ?? 0;
        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
            throw new InvalidOrderError(`Limit must be a whole number from 1 to ${MAX_PAGE_SIZE}.`);
        }
        if (!Number.isSafeInteger(offset) || offset < 0) {
            throw new InvalidOrderError("Offset must be a whole number from 0.");
        }

        const orders = await this.repository.list({
            marketplace: query.marketplace === undefined ? undefined : Marketplace.of(query.marketplace),
            status: query.status === undefined ? undefined : OrderStatus.of(query.status),
            limit,
            offset,
        });
        return { orders: orders.map(order => this.toView(order)), limit, offset };
    }

    // An outcome that changes nothing saves nothing, so a redelivery never publishes an event twice.
    private async apply(orderId: string, transition: (order: Order) => boolean): Promise<void> {
        const order = await this.load(orderId);

        if (transition(order)) {
            await this.repository.save(order);
        }
    }

    // An id that is not a UUID names no order, and the database would refuse it instead of finding nothing.
    private async load(orderId: string): Promise<Order> {
        const order = ORDER_ID_FORMAT.test(orderId) ? await this.repository.findById(new Id(orderId)) : null;

        if (!order) {
            throw new OrderNotFoundError(orderId);
        }
        return order;
    }

    private toView(order: Order): OrderView {
        return {
            id: order.id.value,
            marketplace: order.marketplace.value,
            externalOrderId: order.externalOrderId,
            status: order.status.value,
            total: order.total.amount,
            items: order.items.map(item => ({ sku: item.sku, quantity: item.quantity, unitPrice: item.unitPrice.amount })),
            cancellationReason: order.cancellationReason?.value ?? null,
            createdAt: order.orderedAt,
            updatedAt: order.updatedAt,
        };
    }

}
