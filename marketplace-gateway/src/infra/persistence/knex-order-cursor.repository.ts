import { Knex } from 'knex';
import { Marketplace } from '../../core/marketplace/model/marketplace';
import { OrderCursorRepositoryPort } from '../../core/order/port/out/order-cursor.repository';

export class KnexOrderCursorRepository implements OrderCursorRepositoryPort {

    constructor(private readonly knex: Knex) {}

    async find(marketplace: Marketplace): Promise<Date | null> {
        const row = await this.knex('order_cursors').where({ marketplace }).first<{ last_polled_at: Date } | undefined>();

        return row ? row.last_polled_at : null;
    }

    async save(marketplace: Marketplace, startedAt: Date): Promise<void> {
        await this.knex('order_cursors')
            .insert({ marketplace, last_polled_at: startedAt })
            .onConflict('marketplace')
            .merge();
    }

}
