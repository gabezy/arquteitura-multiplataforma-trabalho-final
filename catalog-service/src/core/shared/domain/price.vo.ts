import { ValueObject } from "./value.object";

export class Price implements ValueObject<Price, number> {

    private _price: number;

    constructor(price: number) {
        if (price < 0) {
            throw new Error("Price cannot be negative");
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