import { ValueObject } from "../../shared/domain/value.object";
import { InvalidProductError } from "./product.errors";

const SKU_FORMAT = /^[A-Z0-9][A-Z0-9-]{2,49}$/;

// Stored in upper case, so "nb-001" and "NB-001" are the same SKU.
export class Sku implements ValueObject<Sku, string> {

    private readonly _sku: string;

    constructor(sku: string) {
        const normalized = typeof sku === "string" ? sku.trim().toUpperCase() : "";

        if (!SKU_FORMAT.test(normalized)) {
            throw new InvalidProductError(
                "SKU must have 3 to 50 characters: letters, digits or hyphens, starting with a letter or digit.",
            );
        }

        this._sku = normalized;
    }

    public get value() {
        return this._sku;
    }

    equals(vo?: Sku): boolean {
        if (vo === null || vo === undefined) {
            return false;
        }

        if (!(vo instanceof Sku)) {
            return false;
        }

        return this.value === vo.value;
    }

}
