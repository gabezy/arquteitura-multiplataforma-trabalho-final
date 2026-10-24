import type { Knex } from 'knex';

// Money is decimal(14,2), as in the other Node services: exact in SQL sums (#31) and readable in reais.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('orders', (t) => {
    t.uuid('id').primary();
    t.text('marketplace').notNullable();
    t.text('external_order_id').notNullable();
    t.text('status').notNullable();
    t.decimal('total', 14, 2).notNullable();
    t.text('cancellation_reason');
    t.timestamp('ordered_at', { useTz: true }).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable();
    t.timestamp('updated_at', { useTz: true }).notNullable();
    t.unique(['marketplace', 'external_order_id']); // one order per marketplace order (idempotency)
    t.index(['created_at', 'id']);                  // GET /orders, newest first
  });

  await knex.schema.createTable('order_items', (t) => {
    t.uuid('order_id').notNullable().references('id').inTable('orders');
    t.integer('line').notNullable();
    t.text('sku').notNullable();
    t.integer('quantity').notNullable();
    t.decimal('unit_price', 14, 2).notNullable();
    t.primary(['order_id', 'line']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('order_items');
  await knex.schema.dropTable('orders');
}
