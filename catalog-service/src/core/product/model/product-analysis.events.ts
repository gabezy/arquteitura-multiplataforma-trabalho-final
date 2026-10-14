import { DomainEvent } from "../../shared/domain/domain.event";

export class ProductAnalysisApproved extends DomainEvent {

    readonly eventName = 'ProductAnalysisApproved';

    constructor(aggregateId: string, readonly sku: string) {
        super(aggregateId);
    }

}

export class ProductAnalysisRejected extends DomainEvent {

    readonly eventName = 'ProductAnalysisRejected';

    constructor(aggregateId: string, readonly sku: string) {
        super(aggregateId);
    }

}
