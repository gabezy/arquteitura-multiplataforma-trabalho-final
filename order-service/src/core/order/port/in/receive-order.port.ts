import { Marketplace } from '../../model/marketplace';
import { OrderOutput } from './order.output';

export interface ReceiveOrderPortInput {
    // ce_id of the message, recorded so a redelivery is skipped. Absent when the message has none.
    eventId?: string;
    marketplace: Marketplace;
    externalOrderId: string;
    items: { sku: string; quantity: number; unitPrice: number }[];
    orderedAt: Date;
}

// duplicate: the marketplace order already exists. The stored order is kept, and `order`
// is the one built from this message, which was not saved.
export interface ReceiveOrderPortOutput {
    outcome: 'created' | 'duplicate';
    order: OrderOutput;
}

export interface ReceiveOrderPort {
    receive(input: ReceiveOrderPortInput): Promise<ReceiveOrderPortOutput>;
}
