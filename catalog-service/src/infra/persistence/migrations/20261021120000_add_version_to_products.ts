import type { Knex } from 'knex';

// Optimistic locking for stock changes: a write succeeds only if the row still has the version it was read with.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('products', (t) => {
    t.integer('version').notNullable().defaultTo(0);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('products', (t) => {
    t.dropColumn('version');
  });
}
