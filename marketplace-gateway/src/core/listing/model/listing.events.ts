import { Marketplace } from '../../marketplace/model/marketplace';
import { DomainEvent } from '../../shared/domain/domain.event';

// Both events are keyed by the product, so every event of a product stays in order inside its topic.
export class ListingPublished extends DomainEvent {
    readonly eventName = 'ListingPublished';

    constructor(
        productId: string,
        readonly sku: string,
        readonly marketplace: Marketplace,
        readonly externalListingId: string,
        readonly publishedAt: Date,
    ) {
        super(productId);
    }
}

export class ListingFailed extends DomainEvent {
    readonly eventName = 'ListingFailed';

    constructor(
        productId: string,
        readonly sku: string,
        readonly marketplace: Marketplace,
        readonly reason: string,
        readonly attempts: number,
    ) {
        super(productId);
    }
}
