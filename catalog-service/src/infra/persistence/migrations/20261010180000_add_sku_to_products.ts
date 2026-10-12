import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('products', (t) => {
    t.string('sku', 50);
  });

  // Products created before this migration get their id as SKU, which is unique and fits the format.
  await knex('products').update({ sku: knex.raw('UPPER(CAST(id AS TEXT))') });

  await knex.schema.alterTable('products', (t) => {
    t.string('sku', 50).notNullable().alter();
    t.unique(['sku'], { indexName: 'products_sku_unique' });
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('products', (t) => {
    t.dropUnique(['sku'], 'products_sku_unique');
    t.dropColumn('sku');
  });
}
