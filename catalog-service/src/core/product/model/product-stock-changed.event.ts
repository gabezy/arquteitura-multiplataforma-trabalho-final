import { DomainEvent } from "../../shared/domain/domain.event";

export class ProductStockChanged extends DomainEvent {

    readonly eventName = 'ProductStockChanged';

    constructor(aggregateId: string, readonly sku: string, readonly stock: number) {
        super(aggregateId);
    }

}
