import type { Knex } from 'knex';

// Where the last successful poll of each marketplace started.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('order_cursors', (t) => {
    t.text('marketplace').primary();
    t.timestamp('last_polled_at', { useTz: true }).notNullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('order_cursors');
}
