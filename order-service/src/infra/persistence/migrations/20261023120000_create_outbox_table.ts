import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('outbox', (t) => {
  t.bigIncrements("sequence");                 // global order for the relay
  t.uuid("event_id").notNullable().unique();
  t.string("aggregate_type").notNullable();    // e.g. "Order"
  t.uuid("aggregate_id").notNullable();        // becomes the Kafka key
  t.string("event_type").notNullable();
  t.jsonb("payload").notNullable();
  t.jsonb("headers");                          // traceparent etc.
  t.timestamp("occurred_at").notNullable();
  t.timestamp("published_at");                 // null = pending
  t.index(["published_at", "sequence"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('outbox');
}