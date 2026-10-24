import { ValidationError } from "./domain.error";
import { ValueObject } from "./value.object";

export class InvalidMoneyError extends ValidationError {}

// Reais with at most two decimals, the shortest form JavaScript prints for them (no exponent).
const REAIS = /^(\d+)(?:\.(\d{1,2}))?$/;

// An amount in reais kept as integer cents, so sums and products are exact.
// A JS number in reais is not: 3 × 0.1 gives 0.30000000000000004.
export class Money implements ValueObject<Money, number> {

    private constructor(readonly cents: number) {}

    static zero(): Money {
        return new Money(0);
    }

    // Reads the decimal text of the number, never multiplies the float by 100.
    static fromReais(reais: number): Money {
        const match = REAIS.exec(String(reais));
        if (!match) {
            throw new InvalidMoneyError(`${reais} is not an amount in reais with at most two decimals.`);
        }

        const [, whole, fraction = ''] = match;
        return Money.fromCents(Number(whole) * 100 + Number(fraction.padEnd(2, '0')));
    }

    private static fromCents(cents: number): Money {
        if (!Number.isSafeInteger(cents)) {
            throw new InvalidMoneyError('The amount is too large.');
        }
        return new Money(cents);
    }

    times(quantity: number): Money {
        return Money.fromCents(this.cents * quantity);
    }

    plus(other: Money): Money {
        return Money.fromCents(this.cents + other.cents);
    }

    toReais(): number {
        return this.cents / 100;
    }

    get value(): number {
        return this.cents;
    }

    equals(vo?: Money): boolean {
        return vo instanceof Money && this.cents === vo.cents;
    }

}
