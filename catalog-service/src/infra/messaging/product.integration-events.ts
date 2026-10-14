import { ProductCreated } from "../../core/product/model/product-created.event";
import { ProductAnalysisApproved, ProductAnalysisRejected } from "../../core/product/model/product-analysis.events";
import { IntegrationEventMapper } from "./integration-event";

export const toProductIntegrationEvent: IntegrationEventMapper = event => {
    if (event instanceof ProductCreated) {
        return {
            type: 'catalog.product.created.v1',
            data: {
                productId: event.aggregateId,
                sku: event.sku,
                name: event.name,
                description: event.description,
                price: event.price,
                stock: event.stock,
            },
        };
    }

    if (event instanceof ProductAnalysisApproved) {
        return { type: 'catalog.product.approved.v1', data: { productId: event.aggregateId, sku: event.sku } };
    }

    if (event instanceof ProductAnalysisRejected) {
        return { type: 'catalog.product.rejected.v1', data: { productId: event.aggregateId, sku: event.sku } };
    }

    throw new Error(`No integration event for ${event.eventName}.`);
};
