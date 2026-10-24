import { Money } from "../../core/order/model/money.vo";
import { OrderItemSnapshot } from "../../core/order/model/order-item.vo";
import { OrderCancelled, OrderConfirmed, OrderPlaced } from "../../core/order/model/order.events";
import { IntegrationEventMapper } from "./integration-event";

// The contracts are in ../../../../docs/eventos.md. Money leaves as a JSON number in reais, with at most two
// decimals, which is how the billing-service reads it; dates leave as ISO-8601 in UTC.
export const toOrderIntegrationEvent: IntegrationEventMapper = event => {
    if (event instanceof OrderPlaced) {
        return {
            type: 'order.order.placed.v1',
            data: {
                orderId: event.aggregateId,
                marketplace: event.marketplace,
                externalOrderId: event.externalOrderId,
                items: event.items.map(toWireItem),
            },
        };
    }

    if (event instanceof OrderConfirmed) {
        return {
            type: 'order.order.confirmed.v1',
            data: {
                orderId: event.aggregateId,
                marketplace: event.marketplace,
                externalOrderId: event.externalOrderId,
                items: event.items.map(toWireItem),
                total: Money.ofCents(event.totalCents).amount,
                confirmedAt: event.confirmedAt.toISOString(),
            },
        };
    }

    if (event instanceof OrderCancelled) {
        return {
            type: 'order.order.cancelled.v1',
            data: {
                orderId: event.aggregateId,
                reason: event.reason,
                marketplace: event.marketplace,
                externalOrderId: event.externalOrderId,
            },
        };
    }

    throw new Error(`No integration event for ${event.eventName}.`);
};

function toWireItem(item: OrderItemSnapshot): { sku: string; quantity: number; unitPrice: number } {
    return { sku: item.sku, quantity: item.quantity, unitPrice: Money.ofCents(item.unitPriceCents).amount };
}
