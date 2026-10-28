import { Knex } from 'knex';
import { MarketplaceOrder } from '../../core/order/model/marketplace-order.entity';
import { MarketplaceOrderRepositoryPort } from '../../core/order/port/out/marketplace-order.repository';
import { KnexOutboxRepository } from './knex-outbox.repository';

export class KnexMarketplaceOrderRepository implements MarketplaceOrderRepositoryPort {

    constructor(private readonly knex: Knex, private readonly outbox: KnexOutboxRepository) {}

    async saveIfNew(order: MarketplaceOrder): Promise<boolean> {
        return this.knex.transaction(async tx => {
            const inserted = await tx('marketplace_orders')
                .insert({
                    marketplace: order.marketplace,
                    external_order_id: order.externalOrderId,
                    items: JSON.stringify(order.items),
                    total: order.total,
                    ordered_at: order.orderedAt,
                })
                .onConflict(['marketplace', 'external_order_id'])
                .ignore()
                .returning('external_order_id');

            if (inserted.length === 0) {
                return false;
            }

            await this.outbox.append(tx, 'MarketplaceOrder', order.pullDomainEvents());
            return true;
        });
    }

}
