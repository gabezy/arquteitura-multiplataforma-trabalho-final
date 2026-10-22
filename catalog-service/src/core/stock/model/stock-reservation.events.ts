import { DomainEvent } from "../../shared/domain/domain.event";

export interface ReservedItem {
    sku: string;
    quantity: number;
}

export interface StockShortage {
    sku: string;
    requested: number;
    available: number;
}

export class StockReserved extends DomainEvent {

    readonly eventName = 'StockReserved';

    constructor(aggregateId: string, readonly items: ReservedItem[]) {
        super(aggregateId);
    }

}

export class StockInsufficient extends DomainEvent {

    readonly eventName = 'StockInsufficient';

    constructor(aggregateId: string, readonly items: StockShortage[]) {
        super(aggregateId);
    }

}
