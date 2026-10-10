import { ConflictError, NotFoundError, ValidationError } from "../../shared/domain/domain.error";

export class InvalidProductError extends ValidationError {}

export class ProductNotFoundError extends NotFoundError {
    constructor(readonly productId: string) {
        super(`Product with id ${productId} not found.`);
    }
}

export class InsufficientStockError extends ConflictError {
    constructor() {
        super("Insufficient stock to remove the specified quantity.");
    }
}
