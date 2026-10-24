import type { Knex } from 'knex';

// The listing of a product at a marketplace: at most one per SKU and marketplace.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('listings', (t) => {
    t.uuid('id').primary();
    t.uuid('product_id').notNullable();
    t.text('sku').notNullable();
    t.text('marketplace').notNullable();
    t.text('status').notNullable();                // PENDING, PUBLISHED or FAILED
    t.text('external_listing_id');                 // the id the marketplace gave it; null until published
    t.decimal('price', 12, 2).notNullable();
    t.integer('stock').notNullable();
    t.text('failure_reason');
    t.integer('attempts').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.raw('now()'));
    t.timestamp('updated_at', { useTz: true }).notNullable();
    t.unique(['sku', 'marketplace']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('listings');
}
