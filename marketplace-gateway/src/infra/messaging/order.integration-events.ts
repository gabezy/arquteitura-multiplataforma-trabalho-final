import { OrderReceived } from '../../core/order/model/order-received.event';
import { IntegrationEventMapper } from './integration-event';

export const toOrderIntegrationEvent: IntegrationEventMapper = event => {
    if (event instanceof OrderReceived) {
        return {
            type: 'marketplace.order.received.v1',
            data: {
                marketplace: event.marketplace,
                externalOrderId: event.externalOrderId,
                items: event.items.map(({ sku, quantity, unitPrice }) => ({ sku, quantity, unitPrice })),
                total: event.total,
                orderedAt: event.orderedAt.toISOString(),
            },
        };
    }

    throw new Error(`No integration event for ${event.eventName}.`);
};
