import { ConflictError, NotFoundError, ValidationError } from "../../shared/domain/domain.error";

export class InvalidOrderError extends ValidationError {}

export class OrderNotFoundError extends NotFoundError {
    constructor(readonly orderId: string) {
        super(`Order ${orderId} not found.`);
    }
}

// The outcome contradicts what already happened to the order, e.g. a payment for an order whose stock was refused.
export class OrderStateConflictError extends ConflictError {
    constructor(readonly orderId: string, readonly state: string, readonly attempted: string) {
        super(`Order ${orderId} is ${state} and cannot ${attempted}.`);
    }
}
