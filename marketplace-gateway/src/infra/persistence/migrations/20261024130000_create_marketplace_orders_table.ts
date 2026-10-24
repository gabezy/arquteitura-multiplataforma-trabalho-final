import type { Knex } from 'knex';

// Every order the gateway took from a marketplace. The primary key is what makes a poll that sees
// the same order again publish nothing.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('marketplace_orders', (t) => {
    t.text('marketplace').notNullable();
    t.text('external_order_id').notNullable();
    t.jsonb('items').notNullable();
    t.decimal('total', 14, 2).notNullable();
    t.timestamp('ordered_at', { useTz: true }).notNullable();
    t.timestamp('received_at', { useTz: true }).notNullable().defaultTo(knex.raw('now()'));
    t.primary(['marketplace', 'external_order_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('marketplace_orders');
}
