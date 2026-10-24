import type { Knex } from 'knex';

// Inbox: one row per consumed event id, so a redelivered message is skipped.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('processed_events', (t) => {
    t.text('event_id').primary();
    t.text('event_type').notNullable();
    t.timestamp('processed_at', { useTz: true }).notNullable().defaultTo(knex.raw('now()'));
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('processed_events');
}
