import type { Knex } from 'knex';

// One row per sale of a marketplace. The pair marketplace + external_order_id is the idempotency key of the
// intake: a message delivered twice (or by two consumers at once) finds the order that already exists.
// Items stay in a jsonb column: an order has at most 100, and they are always read with it.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('orders', (t) => {
    t.uuid('id').primary();
    t.string('marketplace', 30).notNullable();
    t.string('external_order_id', 100).notNullable();
    t.string('status', 20).notNullable();
    t.bigInteger('total_cents').notNullable();
    t.string('cancellation_reason', 30);
    t.jsonb('items').notNullable();
    t.timestamp('ordered_at', { useTz: true }).notNullable();       // the date of the sale at the marketplace
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.raw('now()'));
    t.timestamp('updated_at', { useTz: true }).notNullable();
    t.integer('version').notNullable().defaultTo(0);                // optimistic lock
    t.unique(['marketplace', 'external_order_id']);
    t.index(['marketplace', 'status', 'ordered_at']);
    t.check("status in ('RECEIVED', 'CONFIRMED', 'PAID', 'CANCELLED')", [], 'orders_status_check');
    t.check('total_cents >= 0', [], 'orders_total_check');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('orders');
}
