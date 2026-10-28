import { DomainEvent } from "../../shared/domain/domain.event";

export class ProductPriceChanged extends DomainEvent {

    readonly eventName = 'ProductPriceChanged';

    constructor(aggregateId: string, readonly sku: string, readonly price: number) {
        super(aggregateId);
    }

}
