import { Knex } from "knex";
import { Marketplace } from "../../core/order/model/marketplace.vo";
import { OrderItemSnapshot } from "../../core/order/model/order-item.vo";
import { Order } from "../../core/order/model/order.entity";
import {
    MarketplaceSales, OrderListFilter, OrderRepositoryPort, SalesPeriod,
} from "../../core/order/port/out/order.repository";
import { Id } from "../../core/shared/domain/id";
import { ConcurrentModificationError } from "./concurrent-modification.error";
import { KnexOutboxRepository } from "./knex-outbox.repository";

interface OrderRow {
    id: string;
    marketplace: string;
    external_order_id: string;
    status: string;
    total_cents: string | number; // pg returns bigint as a string
    cancellation_reason: string | null;
    items: string | OrderItemSnapshot[];
    ordered_at: Date;
    updated_at: Date;
    version: number;
}

interface SalesRow {
    marketplace: string;
    orders: string | number;
    units: string | number;
    total_cents: string | number;
}

const TABLE_NAME = 'orders';

export class KnexOrderRepository implements OrderRepositoryPort {

    constructor(private readonly knex: Knex, private readonly outbox: KnexOutboxRepository) {}

    async findById(id: Id): Promise<Order | null> {
        const row: OrderRow | undefined = await this.knex(TABLE_NAME).where({ id: id.value }).first();
        return row ? this.toOrder(row) : null;
    }

    async findByExternalId(marketplace: Marketplace, externalOrderId: string): Promise<Order | null> {
        const row: OrderRow | undefined = await this.knex(TABLE_NAME)
            .where({ marketplace: marketplace.value, external_order_id: externalOrderId })
            .first();
        return row ? this.toOrder(row) : null;
    }

    async saveNew(order: Order): Promise<void> {
        await this.knex.transaction(async tx => {
            await this.insert(tx, order);
            await this.outbox.append(tx, 'Order', order.pullDomainEvents());
        });
    }

    // Writes the change only if nobody changed the order since it was read. Only the state moves: the sale
    // itself (marketplace, items, total) never changes.
    async save(order: Order): Promise<void> {
        await this.knex.transaction(async tx => {
            const updated = await tx(TABLE_NAME)
                .where({ id: order.id.value, version: order.version })
                .update({
                    status: order.status.value,
                    cancellation_reason: order.cancellationReason?.value ?? null,
                    updated_at: order.updatedAt,
                    version: order.version + 1,
                });

            if (updated === 0) {
                throw new ConcurrentModificationError(`Order ${order.id.value} was modified concurrently.`);
            }

            await this.outbox.append(tx, 'Order', order.pullDomainEvents());
        });
    }

    async list(filter: OrderListFilter): Promise<Order[]> {
        const query = this.knex(TABLE_NAME)
            .select()
            .orderBy([{ column: 'ordered_at', order: 'desc' }, { column: 'id', order: 'desc' }])
            .limit(filter.limit)
            .offset(filter.offset);

        if (filter.marketplace) {
            query.where('marketplace', filter.marketplace.value);
        }
        if (filter.status) {
            query.where('status', filter.status.value);
        }

        const rows: OrderRow[] = await query;
        return rows.map(row => this.toOrder(row));
    }

    // The units of an order are the sum of the quantities of its items, read from the jsonb in one pass.
    async salesByMarketplace(period: SalesPeriod): Promise<MarketplaceSales[]> {
        const rows: SalesRow[] = await this.knex({ o: TABLE_NAME })
            .joinRaw(`cross join lateral (
                select coalesce(sum((item ->> 'quantity')::int), 0) as quantity
                  from jsonb_array_elements(o.items) as item
            ) as units`)
            .whereIn('o.status', period.statuses.map(status => status.value))
            .where('o.ordered_at', '>=', period.fromInclusive)
            .where('o.ordered_at', '<', period.toExclusive)
            .groupBy('o.marketplace')
            .orderBy('o.marketplace')
            .select('o.marketplace')
            .count({ orders: '*' })
            .sum({ units: 'units.quantity', total_cents: 'o.total_cents' });

        return rows.map(row => ({
            marketplace: row.marketplace,
            orders: toInteger(row.orders),
            units: toInteger(row.units),
            totalCents: toInteger(row.total_cents),
        }));
    }

    // If another delivery of the same marketplace order stored it meanwhile, that one stands: the retry
    // finds it and does nothing.
    private async insert(tx: Knex.Transaction, order: Order): Promise<void> {
        try {
            await tx(TABLE_NAME).insert({
                id: order.id.value,
                marketplace: order.marketplace.value,
                external_order_id: order.externalOrderId,
                status: order.status.value,
                total_cents: order.total.value,
                cancellation_reason: order.cancellationReason?.value ?? null,
                items: JSON.stringify(order.items.map(item => item.value)),
                ordered_at: order.orderedAt,
                updated_at: order.updatedAt,
            });
        } catch (err) {
            if (isUniqueViolation(err)) {
                throw new ConcurrentModificationError(
                    `Order ${order.marketplace.value}:${order.externalOrderId} was received concurrently.`,
                );
            }
            throw err;
        }
    }

    private toOrder(row: OrderRow): Order {
        return Order.restore({
            id: row.id,
            marketplace: row.marketplace,
            externalOrderId: row.external_order_id,
            status: row.status,
            totalCents: toInteger(row.total_cents),
            cancellationReason: row.cancellation_reason,
            items: typeof row.items === 'string' ? JSON.parse(row.items) : row.items,
            orderedAt: row.ordered_at,
            updatedAt: row.updated_at,
            version: row.version,
        });
    }

}

function toInteger(value: string | number): number {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) {
        throw new Error(`Stored amount ${value} is not a whole number JavaScript can hold exactly.`);
    }
    return number;
}

// Postgres reports unique and primary key violations as 23505.
function isUniqueViolation(err: unknown): boolean {
    return ((err ?? {}) as { code?: string }).code === '23505';
}
