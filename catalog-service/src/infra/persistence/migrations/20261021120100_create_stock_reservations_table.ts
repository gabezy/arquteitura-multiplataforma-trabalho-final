import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('stock_reservations', (t) => {
    t.uuid('order_id').primary();
    t.string('status').notNullable();
    t.jsonb('items').notNullable();
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('stock_reservations');
}
