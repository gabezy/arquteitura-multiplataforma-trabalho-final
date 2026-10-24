import { Knex } from 'knex';
import { Order } from '../../core/order/model/order.entity';
import { KnexOutboxRepository } from './knex-outbox.repository';

// The consumed event recorded in processed_events with the order.
const RECEIVED_EVENT_TYPE = 'marketplace.order.received.v1';

export class KnexOrderRepository {

    constructor(
        private readonly db: Knex,
        private readonly outbox: KnexOutboxRepository,
    ) {}

    // The unique (marketplace, external_order_id) decides which of two concurrent copies wins:
    // the other one waits for the first commit and then inserts nothing.
    async saveReceived(order: Order, eventId?: string): Promise<boolean> {
        return this.db.transaction(async tx => {
            const inserted = await tx('orders')
                .insert({
                    id: order.id.value,
                    marketplace: order.marketplace,
                    external_order_id: order.externalOrderId,
                    status: order.status,
                    total: order.total.toReais(),
                    cancellation_reason: order.cancellationReason,
                    ordered_at: order.orderedAt,
                    created_at: order.createdAt,
                    updated_at: order.updatedAt,
                })
                .onConflict(['marketplace', 'external_order_id'])
                .ignore()
                .returning('id');

            if (eventId) {
                await tx('processed_events').insert({ event_id: eventId, event_type: RECEIVED_EVENT_TYPE }).onConflict('event_id').ignore();
            }

            if (inserted.length === 0) {
                return false;
            }

            await tx('order_items').insert(order.items.map(({ sku, quantity, unitPrice }, index) => ({
                order_id: order.id.value,
                line: index + 1,
                sku,
                quantity,
                unit_price: unitPrice.toReais(),
            })));
            await this.outbox.append(tx, 'Order', order.pullDomainEvents());

            return true;
        });
    }

}
