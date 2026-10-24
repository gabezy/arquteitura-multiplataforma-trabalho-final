import { Marketplace } from '../../marketplace/model/marketplace';
import { ValueObject } from '../../shared/domain/value.object';
import { InvalidMarketplaceOrderError } from './marketplace-order.errors';

// The identity of an order before it has an id of its own: the marketplace and the id the
// marketplace gave it. It is also the key and the subject of marketplace.order.received.v1.
export class MarketplaceOrderKey implements ValueObject<MarketplaceOrderKey, string> {

    constructor(readonly marketplace: Marketplace, readonly externalOrderId: string) {
        if (externalOrderId.trim() === '') {
            throw new InvalidMarketplaceOrderError('The id of the order at the marketplace must not be empty.');
        }
    }

    get value(): string {
        return `${this.marketplace}:${this.externalOrderId}`;
    }

    equals(other?: MarketplaceOrderKey): boolean {
        return other instanceof MarketplaceOrderKey && this.value === other.value;
    }

}
