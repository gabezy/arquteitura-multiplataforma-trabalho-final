import { ValueObject } from "../../shared/domain/value.object";
import { Money } from "./money.vo";
import { InvalidOrderError } from "./order.errors";

// What a marketplace sends: the unit price in reais, as a JSON number.
export interface OrderItemInput {
    sku: string;
    quantity: number;
    unitPrice: number;
}

// What the service stores and publishes: the unit price in cents.
export interface OrderItemSnapshot {
    sku: string;
    quantity: number;
    unitPriceCents: number;
}

const MAX_SKU_LENGTH = 100;

// One line of an order. The bounds are the ones the billing-service enforces, so an order that gets here
// can be charged.
export class OrderItem implements ValueObject<OrderItem, OrderItemSnapshot> {

    static readonly MAX_QUANTITY = 10_000;
    static readonly MIN_UNIT_PRICE = Money.ofCents(1);
    static readonly MAX_UNIT_PRICE = Money.ofCents(100_000_000);

    private constructor(
        readonly sku: string,
        readonly quantity: number,
        readonly unitPrice: Money,
    ) {}

    static of(input: OrderItemInput): OrderItem {
        return OrderItem.build(input.sku, input.quantity, Money.ofAmount(input.unitPrice));
    }

    static restore(snapshot: OrderItemSnapshot): OrderItem {
        return OrderItem.build(snapshot.sku, snapshot.quantity, Money.ofCents(snapshot.unitPriceCents));
    }

    private static build(rawSku: string, quantity: number, unitPrice: Money): OrderItem {
        const sku = typeof rawSku === "string" ? rawSku.trim() : "";

        if (sku === "" || sku.length > MAX_SKU_LENGTH) {
            throw new InvalidOrderError(`SKU must have 1 to ${MAX_SKU_LENGTH} characters.`);
        }
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > OrderItem.MAX_QUANTITY) {
            throw new InvalidOrderError(`Quantity of ${sku} must be a whole number from 1 to ${OrderItem.MAX_QUANTITY}.`);
        }
        if (unitPrice.isLessThan(OrderItem.MIN_UNIT_PRICE) || unitPrice.isGreaterThan(OrderItem.MAX_UNIT_PRICE)) {
            throw new InvalidOrderError(
                `Unit price of ${sku} must be from ${OrderItem.MIN_UNIT_PRICE.amount} to ${OrderItem.MAX_UNIT_PRICE.amount}.`,
            );
        }

        return new OrderItem(sku, quantity, unitPrice);
    }

    get total(): Money {
        return this.unitPrice.times(this.quantity);
    }

    equals(vo?: OrderItem): boolean {
        if (!vo) return false;
        return this.sku === vo.sku && this.quantity === vo.quantity && this.unitPrice.equals(vo.unitPrice);
    }

    get value(): OrderItemSnapshot {
        return { sku: this.sku, quantity: this.quantity, unitPriceCents: this.unitPrice.value };
    }

}
