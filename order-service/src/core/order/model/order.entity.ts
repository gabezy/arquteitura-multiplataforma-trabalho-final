import { AggregateRoot } from "../../shared/domain/aggregate.root";
import { Id } from "../../shared/domain/id";
import { CancellationReason } from "./cancellation-reason.vo";
import { Marketplace } from "./marketplace.vo";
import { Money } from "./money.vo";
import { OrderItem, OrderItemInput, OrderItemSnapshot } from "./order-item.vo";
import { OrderStatus } from "./order-status.vo";
import { OrderCancelled, OrderConfirmed, OrderPlaced } from "./order.events";
import { InvalidOrderError, OrderStateConflictError } from "./order.errors";

const MAX_ITEMS = 100;
const MAX_EXTERNAL_ORDER_ID_LENGTH = 100;

// What a marketplace tells us about a sale, with money in reais as JSON numbers.
export interface ReceiveOrderInput {
    marketplace: string;
    externalOrderId: string;
    items: OrderItemInput[];
    total: number;
    orderedAt: Date;
}

export interface OrderSnapshot {
    id: string;
    marketplace: string;
    externalOrderId: string;
    status: string;
    totalCents: number;
    cancellationReason: string | null;
    items: OrderItemSnapshot[];
    orderedAt: Date;
    updatedAt: Date;
    version: number;
}

interface OrderProps {
    id: Id;
    marketplace: Marketplace;
    externalOrderId: string;
    status: OrderStatus;
    total: Money;
    cancellationReason: CancellationReason | null;
    items: OrderItem[];
    orderedAt: Date;
    updatedAt: Date;
    version: number;
}

// A sale of a marketplace. It is RECEIVED while the catalog answers about the stock, CONFIRMED once the stock
// is reserved (the billing-service charges it from here), then PAID, or CANCELLED when the stock or the
// payment is refused. Every outcome arrives at least once, so each transition returns whether it changed the
// order: the same outcome again is a no-op, and one that contradicts the history is a conflict.
export class Order extends AggregateRoot<Id> {

    private readonly _marketplace: Marketplace;
    private readonly _externalOrderId: string;
    private readonly _items: OrderItem[];
    private readonly _total: Money;
    private readonly _orderedAt: Date;
    private readonly _version: number;
    private _status: OrderStatus;
    private _cancellationReason: CancellationReason | null;
    private _updatedAt: Date;

    static receive(input: ReceiveOrderInput, now: Date): Order {
        if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > MAX_ITEMS) {
            throw new InvalidOrderError(`An order must have 1 to ${MAX_ITEMS} items.`);
        }

        const order = new Order({
            id: new Id(),
            marketplace: Marketplace.of(input.marketplace),
            externalOrderId: input.externalOrderId,
            status: OrderStatus.RECEIVED,
            total: Money.ofAmount(input.total),
            cancellationReason: null,
            items: input.items.map(item => OrderItem.of(item)),
            orderedAt: input.orderedAt,
            updatedAt: now,
            version: 0,
        });
        order.record(new OrderPlaced(
            order.id.value, order.marketplace.value, order.externalOrderId, order.items.map(item => item.value),
        ));
        return order;
    }

    static restore(snapshot: OrderSnapshot): Order {
        return new Order({
            id: new Id(snapshot.id),
            marketplace: Marketplace.of(snapshot.marketplace),
            externalOrderId: snapshot.externalOrderId,
            status: OrderStatus.of(snapshot.status),
            total: Money.ofCents(snapshot.totalCents),
            cancellationReason: snapshot.cancellationReason === null ? null : CancellationReason.of(snapshot.cancellationReason),
            items: snapshot.items.map(item => OrderItem.restore(item)),
            orderedAt: snapshot.orderedAt,
            updatedAt: snapshot.updatedAt,
            version: snapshot.version,
        });
    }

    private constructor(props: OrderProps) {
        super(props.id);
        this._marketplace = props.marketplace;
        this._externalOrderId = typeof props.externalOrderId === "string" ? props.externalOrderId.trim() : "";
        this._items = props.items;
        this._total = props.total;
        this._orderedAt = props.orderedAt;
        this._version = props.version;
        this._status = props.status;
        this._cancellationReason = props.cancellationReason;
        this._updatedAt = props.updatedAt;

        this.validate();
    }

    protected validate(): void {
        if (this._externalOrderId === "" || this._externalOrderId.length > MAX_EXTERNAL_ORDER_ID_LENGTH) {
            throw new InvalidOrderError(`External order id must have 1 to ${MAX_EXTERNAL_ORDER_ID_LENGTH} characters.`);
        }
        if (!(this._orderedAt instanceof Date) || Number.isNaN(this._orderedAt.getTime())) {
            throw new InvalidOrderError("Ordered at must be a valid date.");
        }
        if (this._items.length < 1 || this._items.length > MAX_ITEMS) {
            throw new InvalidOrderError(`An order must have 1 to ${MAX_ITEMS} items.`);
        }

        const itemsTotal = this._items.reduce((sum, item) => sum.plus(item.total), Money.ofCents(0));
        if (!this._total.equals(itemsTotal)) {
            throw new InvalidOrderError(
                `Declared total ${this._total.amount} differs from the sum of the items ${itemsTotal.amount}.`,
            );
        }

        const cancelled = this._status.equals(OrderStatus.CANCELLED);
        if (cancelled !== (this._cancellationReason !== null)) {
            throw new InvalidOrderError("Only a cancelled order has a cancellation reason, and it always has one.");
        }
    }

    get marketplace(): Marketplace {
        return this._marketplace;
    }

    get externalOrderId(): string {
        return this._externalOrderId;
    }

    get items(): readonly OrderItem[] {
        return this._items;
    }

    get total(): Money {
        return this._total;
    }

    get status(): OrderStatus {
        return this._status;
    }

    get cancellationReason(): CancellationReason | null {
        return this._cancellationReason;
    }

    // The date of the sale at the marketplace.
    get orderedAt(): Date {
        return this._orderedAt;
    }

    // The last change in this service.
    get updatedAt(): Date {
        return this._updatedAt;
    }

    // The version the order was read with. The repository uses it for optimistic locking.
    get version(): number {
        return this._version;
    }

    // The stock was reserved.
    confirm(now: Date): boolean {
        if (this.hasBeenConfirmed()) {
            return false;
        }
        this.requireStatus(OrderStatus.RECEIVED, "be confirmed");

        this._status = OrderStatus.CONFIRMED;
        this._updatedAt = now;
        this.record(new OrderConfirmed(
            this.id.value, this._marketplace.value, this._externalOrderId,
            this._items.map(item => item.value), this._total.value, now,
        ));
        return true;
    }

    // The catalog had no stock for the order.
    cancelForStock(now: Date): boolean {
        if (this.isCancelledFor(CancellationReason.OUT_OF_STOCK)) {
            return false;
        }
        this.requireStatus(OrderStatus.RECEIVED, "be cancelled for lack of stock");

        this.cancel(CancellationReason.OUT_OF_STOCK, now);
        return true;
    }

    // The billing-service charged the order.
    markPaid(now: Date): boolean {
        if (this._status.equals(OrderStatus.PAID)) {
            return false;
        }
        this.requireStatus(OrderStatus.CONFIRMED, "be paid");

        this._status = OrderStatus.PAID;
        this._updatedAt = now;
        return true;
    }

    // The payment was refused.
    cancelForPayment(now: Date): boolean {
        if (this.isCancelledFor(CancellationReason.PAYMENT_FAILED)) {
            return false;
        }
        this.requireStatus(OrderStatus.CONFIRMED, "be cancelled for a failed payment");

        this.cancel(CancellationReason.PAYMENT_FAILED, now);
        return true;
    }

    private cancel(reason: CancellationReason, now: Date): void {
        this._status = OrderStatus.CANCELLED;
        this._cancellationReason = reason;
        this._updatedAt = now;
        this.record(new OrderCancelled(this.id.value, reason.value, this._marketplace.value, this._externalOrderId));
    }

    // A redelivered stock answer must not conflict with an order that already moved on: confirmed, paid, or
    // cancelled for payment, which only a confirmed order can be.
    private hasBeenConfirmed(): boolean {
        return this._status.equals(OrderStatus.CONFIRMED)
            || this._status.equals(OrderStatus.PAID)
            || this.isCancelledFor(CancellationReason.PAYMENT_FAILED);
    }

    private isCancelledFor(reason: CancellationReason): boolean {
        return this._status.equals(OrderStatus.CANCELLED) && reason.equals(this._cancellationReason ?? undefined);
    }

    private requireStatus(expected: OrderStatus, attempted: string): void {
        if (!this._status.equals(expected)) {
            const reason = this._cancellationReason ? ` (${this._cancellationReason.value})` : "";
            throw new OrderStateConflictError(this.id.value, `${this._status.value}${reason}`, attempted);
        }
    }

}
