import { StockInsufficient, StockReserved } from "../../core/stock/model/stock-reservation.events";
import { IntegrationEventMapper } from "./integration-event";
import { toProductIntegrationEvent } from "./product.integration-events";

// A stock change saves reservation and product events together, so product events are mapped here too.
export const toStockIntegrationEvent: IntegrationEventMapper = event => {
    if (event instanceof StockReserved) {
        return { type: 'catalog.stock.reserved.v1', data: { orderId: event.aggregateId, items: event.items } };
    }

    if (event instanceof StockInsufficient) {
        return { type: 'catalog.stock.insufficient.v1', data: { orderId: event.aggregateId, items: event.items } };
    }

    return toProductIntegrationEvent(event);
};
