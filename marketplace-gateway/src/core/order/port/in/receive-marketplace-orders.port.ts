import { Marketplace } from '../../../marketplace/model/marketplace';

export interface ReceiveMarketplaceOrdersInput {
    marketplace: Marketplace;
}

export interface DiscardedOrder {
    externalOrderId: string;
    reason: string;
}

export interface ReceiveMarketplaceOrdersOutput {
    fetched: number;
    received: number;
    discarded: DiscardedOrder[];
}

export interface ReceiveMarketplaceOrdersPort {
    receive(input: ReceiveMarketplaceOrdersInput): Promise<ReceiveMarketplaceOrdersOutput>;
}
