import { ValidationError } from "./domain.error";
import { ValueObject } from "./value.object";

export class Quantity implements ValueObject<Quantity, number> {

    private readonly _quantity: number;

    constructor(quantity: number) {
        if (!Number.isInteger(quantity) || quantity < 0) {
            throw new ValidationError("Quantity must be a non-negative integer.");
        }

        this._quantity = quantity;
    }

    public get value() {
        return this._quantity;
    }

    isZero(): boolean {
        return this._quantity === 0;
    }

    isLessThan(other: Quantity): boolean {
        return this._quantity < other.value;
    }

    add(other: Quantity): Quantity {
        return new Quantity(this._quantity + other.value);
    }

    subtract(other: Quantity): Quantity {
        return new Quantity(this._quantity - other.value);
    }

    equals(vo?: Quantity): boolean {
        if (vo === null || vo === undefined) {
            return false;
        }

        if (!(vo instanceof Quantity)) {
            return false;
        }

        return this.value === vo.value;
    }

}
