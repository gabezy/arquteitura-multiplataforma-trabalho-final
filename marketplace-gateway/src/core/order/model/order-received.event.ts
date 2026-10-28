import { DomainEvent } from '../../shared/domain/domain.event';
import { Marketplace } from '../../marketplace/model/marketplace';

export interface OrderReceivedItem {
    sku: string;
    quantity: number;
    unitPrice: number;
}

export class OrderReceived extends DomainEvent {
    readonly eventName = 'OrderReceived';

    constructor(
        orderKey: string,
        readonly marketplace: Marketplace,
        readonly externalOrderId: string,
        readonly items: readonly OrderReceivedItem[],
        readonly total: number,
        readonly orderedAt: Date,
    ) {
        super(orderKey);
    }
}
