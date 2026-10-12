import { ConflictError, NotFoundError, ValidationError } from "../../shared/domain/domain.error";

export class InvalidProductError extends ValidationError {}

export class ProductNotFoundError extends NotFoundError {
    constructor(readonly sku: string) {
        super(`Product with SKU ${sku} not found.`);
    }
}

export class InsufficientStockError extends ConflictError {
    constructor() {
        super("Insufficient stock to remove the specified quantity.");
    }
}

export class DuplicateSkuError extends ConflictError {
    constructor(readonly skus: string[]) {
        super(`Product with SKU ${skus.join(", ")} already exists.`);
    }
}
