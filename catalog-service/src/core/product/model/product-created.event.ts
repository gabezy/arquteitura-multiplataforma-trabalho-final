import { DomainEvent } from "../../shared/domain/domain.event";

export class ProductCreated extends DomainEvent {

    readonly eventName = 'ProductCreated';

    constructor(
        aggregateId: string,
        readonly sku: string,
        readonly name: string,
        readonly description: string,
        readonly price: number,
        readonly stock: number
    ) {
        super(aggregateId);
    }

}
