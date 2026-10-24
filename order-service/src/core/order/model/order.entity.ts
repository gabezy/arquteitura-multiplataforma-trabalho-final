import { AggregateRoot } from '../../shared/domain/aggregate.root';
import { Id } from '../../shared/domain/id';
import { Money } from '../../shared/domain/money.vo';
import { Marketplace } from './marketplace';
import { CancellationReason, OrderStatus } from './order-status';
import { InvalidOrderError } from './order.errors';
import { OrderPlaced } from './order-placed.event';

export interface OrderItem {
    sku: string;
    quantity: number;
    unitPrice: Money;
}

export interface ReceiveOrderProps {
    marketplace: Marketplace;
    externalOrderId: string;
    items: { sku: string; quantity: number; unitPrice: number }[];
    orderedAt: Date;
}

interface OrderProps {
    marketplace: Marketplace;
    externalOrderId: string;
    status: OrderStatus;
    items: OrderItem[];
    cancellationReason: CancellationReason | null;
    orderedAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

// A sale on a marketplace. Its total always comes from its items, never from what the
// marketplace declared, because the billing recomputes it the same way (#23).
export class Order extends AggregateRoot<Id> {

    readonly marketplace: Marketplace;
    readonly externalOrderId: string;
    readonly items: readonly OrderItem[];
    readonly orderedAt: Date;
    readonly createdAt: Date;
    private _status: OrderStatus;
    private _cancellationReason: CancellationReason | null;
    private _updatedAt: Date;

    private constructor(id: Id, props: OrderProps) {
        super(id);
        this.marketplace = props.marketplace;
        this.externalOrderId = props.externalOrderId;
        this.items = props.items;
        this.orderedAt = props.orderedAt;
        this.createdAt = props.createdAt;
        this._status = props.status;
        this._cancellationReason = props.cancellationReason;
        this._updatedAt = props.updatedAt;
        this.validate();
    }

    static receive(props: ReceiveOrderProps): Order {
        const now = new Date();
        const order = new Order(new Id(), {
            marketplace: props.marketplace,
            externalOrderId: props.externalOrderId.trim(),
            status: 'RECEIVED',
            items: props.items.map(({ sku, quantity, unitPrice }) => ({ sku: sku.trim(), quantity, unitPrice: Money.fromReais(unitPrice) })),
            cancellationReason: null,
            orderedAt: props.orderedAt,
            createdAt: now,
            updatedAt: now,
        });

        order.record(new OrderPlaced(order.id.value, order.marketplace, order.externalOrderId, order.items));

        return order;
    }

    get status(): OrderStatus {
        return this._status;
    }

    get cancellationReason(): CancellationReason | null {
        return this._cancellationReason;
    }

    get updatedAt(): Date {
        return this._updatedAt;
    }

    get total(): Money {
        return this.items.reduce((sum, { quantity, unitPrice }) => sum.plus(unitPrice.times(quantity)), Money.zero());
    }

    protected validate(): void {
        if (this.externalOrderId === '') {
            throw new InvalidOrderError('The id of the order at the marketplace must not be empty.');
        }

        if (this.items.length === 0) {
            throw new InvalidOrderError('An order needs at least one item.');
        }

        for (const { sku, quantity } of this.items) {
            if (sku === '') {
                throw new InvalidOrderError('An item needs a SKU.');
            }
            if (!Number.isSafeInteger(quantity) || quantity <= 0) {
                throw new InvalidOrderError(`The quantity of ${sku} must be an integer greater than zero.`);
            }
        }

        if (Number.isNaN(this.orderedAt.getTime())) {
            throw new InvalidOrderError('The order date is not a valid date.');
        }
    }

}
