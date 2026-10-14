import { ValidationError } from "./domain.error";
import { ValueObject } from "./value.object";

export class Price implements ValueObject<Price, number> {

    private _price: number;

    constructor(price: number) {
        if (!Number.isFinite(price) || price < 0) {
            throw new ValidationError("Price must be a non-negative number.");
        }
        
        this._price = price;
    }

    public get value() {
        return this._price;
    }

    equals(vo?: Price): boolean {
        if (vo === null || vo === undefined) {
            return false;
        }

        if (!(vo instanceof Price)) {
            return false;
        }

        return this.value === vo.value;
    }

}