import { Marketplace } from '../../../marketplace/model/marketplace';

export interface CancelMarketplaceOrderInput {
    marketplace: Marketplace;
    externalOrderId: string;
    reason?: string;
}

export interface CancelMarketplaceOrderPort {
    cancel(input: CancelMarketplaceOrderInput): Promise<void>;
}
