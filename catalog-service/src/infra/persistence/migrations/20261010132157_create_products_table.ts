import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('products', (t) => {
    t.uuid('id').primary();
    t.string('name').notNullable();
    t.text('description').notNullable();
    t.decimal('price', 12, 2).notNullable();
    t.integer('stock').notNullable();
    t.string('analysis_status', 20).notNullable();
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('products');
}