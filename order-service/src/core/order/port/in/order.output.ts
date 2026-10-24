import { Marketplace } from '../../model/marketplace';
import { CancellationReason, OrderStatus } from '../../model/order-status';

// Money in reais with at most two decimals, as every service exchanges it (docs/eventos.md).
export interface OrderOutput {
    id: string;
    marketplace: Marketplace;
    externalOrderId: string;
    status: OrderStatus;
    total: number;
    items: { sku: string; quantity: number; unitPrice: number }[];
    cancellationReason: CancellationReason | null;
    orderedAt: Date;
    createdAt: Date;
    updatedAt: Date;
}
