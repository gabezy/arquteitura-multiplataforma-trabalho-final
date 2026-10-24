import { OrderPlaced } from '../../core/order/model/order-placed.event';
import { IntegrationEventMapper } from './integration-event';

// order.order.placed.v1 (docs/eventos.md): the catalog reads orderId and items[{sku, quantity}]
// and ignores the rest; marketplace, externalOrderId and unitPrice are optional extras.
export const toOrderIntegrationEvent: IntegrationEventMapper = event => {
    if (event instanceof OrderPlaced) {
        return {
            type: 'order.order.placed.v1',
            data: {
                orderId: event.aggregateId,
                marketplace: event.marketplace,
                externalOrderId: event.externalOrderId,
                items: event.items.map(({ sku, quantity, unitPrice }) => ({ sku, quantity, unitPrice: unitPrice.toReais() })),
            },
        };
    }

    throw new Error(`No integration event for ${event.eventName}.`);
};
