import { DomainEvent } from '../../shared/domain/domain.event';
import { Marketplace } from './marketplace';
import { OrderItem } from './order.entity';

// A new order asks the catalog to reserve its stock (ADR-0004).
export class OrderPlaced extends DomainEvent {
    readonly eventName = 'OrderPlaced';

    constructor(
        orderId: string,
        readonly marketplace: Marketplace,
        readonly externalOrderId: string,
        readonly items: readonly OrderItem[],
    ) {
        super(orderId);
    }
}
