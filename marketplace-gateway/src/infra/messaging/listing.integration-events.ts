import { ListingFailed, ListingPublished } from '../../core/listing/model/listing.events';
import { IntegrationEventMapper } from './integration-event';

export const toListingIntegrationEvent: IntegrationEventMapper = event => {
    if (event instanceof ListingPublished) {
        return {
            type: 'marketplace.listing.published.v1',
            data: {
                productId: event.aggregateId,
                sku: event.sku,
                marketplace: event.marketplace,
                externalListingId: event.externalListingId,
                publishedAt: event.publishedAt.toISOString(),
            },
        };
    }

    if (event instanceof ListingFailed) {
        return {
            type: 'marketplace.listing.failed.v1',
            data: {
                productId: event.aggregateId,
                sku: event.sku,
                marketplace: event.marketplace,
                reason: event.reason,
                attempts: event.attempts,
            },
        };
    }

    throw new Error(`No integration event for ${event.eventName}.`);
};
