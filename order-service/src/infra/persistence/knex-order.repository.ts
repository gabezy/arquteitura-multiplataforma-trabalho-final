import { Knex } from 'knex';
import { Marketplace } from '../../core/order/model/marketplace';
import { Order } from '../../core/order/model/order.entity';
import { CancellationReason, OrderStatus } from '../../core/order/model/order-status';
import { OrderFilter, PageRequest } from '../../core/order/port/in/list-orders.port';
import { OrderRepositoryPort } from '../../core/order/port/out/order.repository';
import { Money } from '../../core/shared/domain/money.vo';
import { KnexOutboxRepository } from './knex-outbox.repository';

interface OrderRow {
    id: string;
    marketplace: Marketplace;
    external_order_id: string;
    status: OrderStatus;
    cancellation_reason: CancellationReason | null;
    ordered_at: Date;
    created_at: Date;
    updated_at: Date;
}

interface OrderItemRow {
    order_id: string;
    sku: string;
    quantity: number;
    unit_price: string; // pg returns decimal as text
}

// The consumed event recorded in processed_events with the order.
const RECEIVED_EVENT_TYPE = 'marketplace.order.received.v1';

export class KnexOrderRepository implements OrderRepositoryPort {

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

    async findById(id: string): Promise<Order | null> {
        const [order] = await this.restore(await this.db<OrderRow>('orders').where({ id }));
        return order ?? null;
    }

    async list(filter: OrderFilter, page: PageRequest): Promise<Order[]> {
        const rows = await this.db<OrderRow>('orders')
            .modify(query => {
                if (filter.marketplace) query.where({ marketplace: filter.marketplace });
                if (filter.status) query.where({ status: filter.status });
            })
            .orderBy([{ column: 'created_at', order: 'desc' }, { column: 'id', order: 'desc' }])
            .limit(page.limit)
            .offset(page.offset);

        return this.restore(rows);
    }

    private async restore(rows: OrderRow[]): Promise<Order[]> {
        const items = await this.db<OrderItemRow>('order_items')
            .whereIn('order_id', rows.map(row => row.id))
            .orderBy('line');

        return rows.map(row => Order.restore(row.id, {
            marketplace: row.marketplace,
            externalOrderId: row.external_order_id,
            status: row.status,
            items: items
                .filter(item => item.order_id === row.id)
                .map(item => ({ sku: item.sku, quantity: item.quantity, unitPrice: Money.fromReais(Number(item.unit_price)) })),
            cancellationReason: row.cancellation_reason,
            orderedAt: row.ordered_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        }));
    }

}
