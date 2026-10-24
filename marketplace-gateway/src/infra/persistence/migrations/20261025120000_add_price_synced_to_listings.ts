import type { Knex } from 'knex';

// Whether the marketplace already has the price of the listing. A change of price from the catalog sets it to
// false, and the sync loop of the marketplace sets it back to true once the marketplace accepts the price.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('listings', (t) => {
    t.boolean('price_synced').notNullable().defaultTo(true);
  });

  // What the sync loops look for every few seconds: a handful of rows among all the listings.
  await knex.raw(
    `create index listings_price_unsynced_idx on listings (marketplace, updated_at)
      where price_synced = false and status = 'PUBLISHED'`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('drop index if exists listings_price_unsynced_idx');
  await knex.schema.alterTable('listings', (t) => {
    t.dropColumn('price_synced');
  });
}
