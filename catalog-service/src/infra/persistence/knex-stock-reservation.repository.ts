import { Knex } from "knex";
import { ProductEntity } from "../../core/product/model/product.entity";
import { Id } from "../../core/shared/domain/id";
import { StockReservation } from "../../core/stock/model/stock-reservation.entity";
import { StockReservationStatus } from "../../core/stock/model/stock-reservation-status.vo";
import { ReservedItem } from "../../core/stock/model/stock-reservation.events";
import { StockReservationRepositoryPort } from "../../core/stock/port/out/stock-reservation.repository";
import { ConcurrentModificationError } from "./concurrent-modification.error";
import { KnexOutboxRepository } from "./knex-outbox.repository";

interface StockReservationRow {
    order_id: string;
    status: string;
    items: string | ReservedItem[]; // pg devolve jsonb já parseado, sqlite como string
}

const TABLE_NAME = 'stock_reservations';
const STATUSES = [
    StockReservationStatus.RESERVED,
    StockReservationStatus.REJECTED,
    StockReservationStatus.RELEASED,
    StockReservationStatus.CANCELLED,
];

export class KnexStockReservationRepository implements StockReservationRepositoryPort {

    constructor(private readonly knex: Knex, private readonly outbox: KnexOutboxRepository) {}

    async findByOrderId(orderId: Id): Promise<StockReservation | null> {
        const row: StockReservationRow | undefined = await this.knex(TABLE_NAME).where({ order_id: orderId.value }).first();

        if (!row) {
            return null;
        }

        return StockReservation.restore({
            orderId: new Id(row.order_id),
            items: typeof row.items === 'string' ? JSON.parse(row.items) : row.items,
            status: this.toStatus(row.status),
        });
    }

    async save(reservation: StockReservation, products: ProductEntity[]): Promise<void> {
        await this.knex.transaction(async tx => {
            for (const product of products) {
                await this.updateStock(tx, product);
            }

            if (reservation.status.equals(StockReservationStatus.RELEASED)) {
                await this.markReleased(tx, reservation);
            } else {
                await this.insert(tx, reservation);
            }

            await this.outbox.append(tx, 'StockReservation', reservation.pullDomainEvents());
            await this.outbox.append(tx, 'Product', products.flatMap(product => product.pullDomainEvents()));
        });
    }

    // Every other status is the first answer to the order. If another delivery stored an
    // answer meanwhile, that one stands: the retry finds it and does nothing.
    private async insert(tx: Knex.Transaction, reservation: StockReservation): Promise<void> {
        try {
            await tx(TABLE_NAME).insert({
                order_id: reservation.orderId.value,
                status: reservation.status.value,
                items: JSON.stringify(reservation.items),
            });
        } catch (err) {
            if (isUniqueViolation(err)) {
                throw new ConcurrentModificationError(`Order ${reservation.orderId.value} was answered concurrently.`);
            }
            throw err;
        }
    }

    private async markReleased(tx: Knex.Transaction, reservation: StockReservation): Promise<void> {
        const updated = await tx(TABLE_NAME)
            .where({ order_id: reservation.orderId.value, status: StockReservationStatus.RESERVED.value })
            .update({ status: reservation.status.value, updated_at: tx.fn.now() });

        if (updated === 0) {
            throw new ConcurrentModificationError(`Order ${reservation.orderId.value} was released concurrently.`);
        }
    }

    // Writes the stock only if nobody changed the product since it was read.
    private async updateStock(tx: Knex.Transaction, product: ProductEntity): Promise<void> {
        const updated = await tx('products')
            .where({ id: product.id.value, version: product.version })
            .update({ stock: product.stock.value, version: product.version + 1 });

        if (updated === 0) {
            throw new ConcurrentModificationError(`Product ${product.id.value} was modified concurrently.`);
        }
    }

    private toStatus(value: string): StockReservationStatus {
        const status = STATUSES.find(status => status.value === value);
        if (!status) {
            throw new Error(`Invalid stock reservation status: ${value}`);
        }
        return status;
    }

}

// Postgres reports unique and primary key violations as 23505; SQLite (used in tests) by its own codes.
function isUniqueViolation(err: unknown): boolean {
    const { code } = (err ?? {}) as { code?: string };
    return code === '23505' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || code === 'SQLITE_CONSTRAINT_UNIQUE';
}
