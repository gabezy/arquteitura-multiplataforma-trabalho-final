import { AggregateRoot } from '../../shared/domain/aggregate.root';
import { Marketplace } from '../../marketplace/model/marketplace';
import { MarketplaceOrderKey } from './marketplace-order-key.vo';
import { InvalidMarketplaceOrderError } from './marketplace-order.errors';
import { OrderReceived, OrderReceivedItem } from './order-received.event';

export interface ReceiveMarketplaceOrderProps {
    marketplace: Marketplace;
    externalOrderId: string;
    items: OrderReceivedItem[];
    total: number;
    orderedAt: Date;
}

// An order the gateway took from a marketplace. It is born received and is never changed.
export class MarketplaceOrder extends AggregateRoot<MarketplaceOrderKey> {

    private constructor(
        key: MarketplaceOrderKey,
        readonly items: readonly OrderReceivedItem[],
        readonly total: number,
        readonly orderedAt: Date,
    ) {
        super(key);
        this.validate();
    }

    static receive(props: ReceiveMarketplaceOrderProps): MarketplaceOrder {
        const key = new MarketplaceOrderKey(props.marketplace, props.externalOrderId);
        const order = new MarketplaceOrder(key, props.items.map(item => ({ ...item })), props.total, props.orderedAt);

        order.record(new OrderReceived(key.value, key.marketplace, key.externalOrderId, order.items, order.total, order.orderedAt));

        return order;
    }

    get marketplace(): Marketplace {
        return this.id.marketplace;
    }

    get externalOrderId(): string {
        return this.id.externalOrderId;
    }

    protected validate(): void {
        if (this.items.length === 0) {
            throw new InvalidMarketplaceOrderError('An order needs at least one item.');
        }

        for (const item of this.items) {
            if (item.sku.trim() === '') {
                throw new InvalidMarketplaceOrderError('An item needs a SKU.');
            }
            if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
                throw new InvalidMarketplaceOrderError(`The quantity of ${item.sku} must be an integer greater than zero.`);
            }
            if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
                throw new InvalidMarketplaceOrderError(`The unit price of ${item.sku} must not be negative.`);
            }
        }

        if (!Number.isFinite(this.total) || this.total < 0) {
            throw new InvalidMarketplaceOrderError('The total of the order must not be negative.');
        }

        if (Number.isNaN(this.orderedAt.getTime())) {
            throw new InvalidMarketplaceOrderError('The order date is not a valid date.');
        }
    }

}
