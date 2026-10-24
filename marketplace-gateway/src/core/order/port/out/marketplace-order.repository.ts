import { MarketplaceOrder } from '../../model/marketplace-order.entity';

export interface MarketplaceOrderRepositoryPort {
    // Saves the order and its events in one transaction, unless the marketplace order was
    // already saved. Answers whether it was new.
    saveIfNew(order: MarketplaceOrder): Promise<boolean>;
}
