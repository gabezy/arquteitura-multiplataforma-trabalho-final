import { DomainEvent } from "../../shared/domain/domain.event";
import { OrderItemSnapshot } from "./order-item.vo";

// The order is persisted and waits for the stock answer of the catalog.
export class OrderPlaced extends DomainEvent {

    readonly eventName = "OrderPlaced";

    constructor(
        aggregateId: string,
        readonly marketplace: string,
        readonly externalOrderId: string,
        readonly items: OrderItemSnapshot[],
    ) {
        super(aggregateId);
    }

}

// The stock is reserved: from here the billing-service can charge the order.
export class OrderConfirmed extends DomainEvent {

    readonly eventName = "OrderConfirmed";

    constructor(
        aggregateId: string,
        readonly marketplace: string,
        readonly externalOrderId: string,
        readonly items: OrderItemSnapshot[],
        readonly totalCents: number,
        readonly confirmedAt: Date,
    ) {
        super(aggregateId);
    }

}

export class OrderCancelled extends DomainEvent {

    readonly eventName = "OrderCancelled";

    constructor(
        aggregateId: string,
        readonly reason: string,
        readonly marketplace: string,
        readonly externalOrderId: string,
    ) {
        super(aggregateId);
    }

}
