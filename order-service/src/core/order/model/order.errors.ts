import { NotFoundError, ValidationError } from '../../shared/domain/domain.error';

export class InvalidOrderError extends ValidationError {}

export class OrderNotFoundError extends NotFoundError {
    constructor(readonly orderId: string) {
        super(`Order ${orderId} not found.`);
    }
}
