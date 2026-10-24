import { ValueObject } from "../../shared/domain/value.object";
import { InvalidOrderError } from "./order.errors";

// An amount of reais kept in whole cents, so sums and comparisons never touch a float. `value` is the number
// of cents; `amount` is the same money in reais, which is how it travels in JSON.
export class Money implements ValueObject<Money, number> {

    private constructor(private readonly _cents: number) {}

    static ofCents(cents: number): Money {
        if (!Number.isSafeInteger(cents) || cents < 0) {
            throw new InvalidOrderError("Amount must be a non-negative number of whole cents.");
        }
        return new Money(cents);
    }

    // An amount with more than two decimals is rejected, never rounded: float noise like 0.1 + 0.2 means the
    // sender did arithmetic on floats, and the total of an order must not drift from what it sold.
    static ofAmount(amount: number): Money {
        if (!Number.isFinite(amount)) {
            throw new InvalidOrderError("Amount must be a number.");
        }
        const cents = Math.round(amount * 100);
        if (cents / 100 !== amount) {
            throw new InvalidOrderError("Amount must have at most two decimal places.");
        }
        return Money.ofCents(cents);
    }

    plus(other: Money): Money {
        return Money.ofCents(this._cents + other._cents);
    }

    times(quantity: number): Money {
        return Money.ofCents(this._cents * quantity);
    }

    isLessThan(other: Money): boolean {
        return this._cents < other._cents;
    }

    isGreaterThan(other: Money): boolean {
        return this._cents > other._cents;
    }

    equals(vo?: Money): boolean {
        if (!vo) return false;
        return this._cents === vo.value;
    }

    get value(): number {
        return this._cents;
    }

    get amount(): number {
        return this._cents / 100;
    }

}
