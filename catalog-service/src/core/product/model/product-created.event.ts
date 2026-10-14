import { DomainEvent } from "../../shared/domain/domain.event";

export class ProductCreatedEvent extends DomainEvent {

    readonly eventName = 'ProductCreatedEvent';

    constructor(
        aggregateId: string, 
        readonly name: string,
        readonly description: string,
        readonly price: number,
        readonly stock: number
    ) {
        super(aggregateId);
    }

}