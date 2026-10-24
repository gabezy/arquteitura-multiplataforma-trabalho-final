import { Knex } from 'knex';
import { context, propagation, ROOT_CONTEXT, trace, TraceFlags } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { KnexOutboxRepository } from './knex-outbox.repository';
import { createMigrationSource } from './migration-source';
import { DomainEvent } from '../../core/shared/domain/domain.event';
import { IntegrationEventMapper } from '../messaging/integration-event';
import { createTestDatabase, TestDatabase } from '../testing/test-database';

const PRODUCT_ID = '0b8f2c1e-6a4d-4d1e-9a51-3f0f1b2c7d10';
const ORDER_KEY = 'MERCADO_LIVRE:2000001';
const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const SPAN_ID = 'b7ad6b7169203331';

class ListingPublished extends DomainEvent {
  readonly eventName = 'ListingPublished';

  constructor(aggregateId: string, readonly sku: string) {
    super(aggregateId);
  }
}

class Unmapped extends DomainEvent {
  readonly eventName = 'Unmapped';

  constructor(aggregateId: string) {
    super(aggregateId);
  }
}

// Same convention as the real mappers: an event without a public contract throws.
const toIntegrationEvent: IntegrationEventMapper = event => {
  if (event instanceof ListingPublished) {
    return { type: 'marketplace.listing.published.v1', data: { productId: event.aggregateId, sku: event.sku } };
  }
  throw new Error(`No integration event for ${event.eventName}.`);
};

describe('KnexOutboxRepository', () => {
  let testDatabase: TestDatabase;
  let db: Knex;
  const outbox = new KnexOutboxRepository(toIntegrationEvent);

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    db = testDatabase.db;
    await db.migrate.latest({ migrationSource: createMigrationSource() });
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  });

  afterEach(async () => {
    await db('outbox').truncate();
  });

  afterAll(async () => {
    context.disable();
    propagation.disable();
    await testDatabase?.destroy();
  });

  it('stores one pending row per event with its public type, data and the active trace context', async () => {
    const event = new ListingPublished(PRODUCT_ID, 'NB-001');
    const spanContext = { traceId: TRACE_ID, spanId: SPAN_ID, traceFlags: TraceFlags.SAMPLED };

    await context.with(trace.setSpanContext(ROOT_CONTEXT, spanContext), () =>
      db.transaction(tx => outbox.append(tx, 'Listing', [event])),
    );

    const rows = await db('outbox').select();
    expect(rows).toEqual([
      {
        sequence: expect.any(String),
        event_id: event.eventId,
        aggregate_type: 'Listing',
        aggregate_id: PRODUCT_ID,
        event_type: 'marketplace.listing.published.v1',
        payload: { productId: PRODUCT_ID, sku: 'NB-001' },
        headers: { traceparent: `00-${TRACE_ID}-${SPAN_ID}-01` },
        occurred_at: event.occurredOn,
        published_at: null,
      },
    ]);
  });

  it('accepts an aggregate id that is not a UUID, such as the key of a marketplace order', async () => {
    await db.transaction(tx => outbox.append(tx, 'MarketplaceOrder', [new ListingPublished(ORDER_KEY, 'NB-001')]));

    expect(await db('outbox').pluck('aggregate_id')).toEqual([ORDER_KEY]);
  });

  it('writes no row when one event of the transaction has no mapping', async () => {
    const append = db.transaction(tx =>
      outbox.append(tx, 'Listing', [new ListingPublished(PRODUCT_ID, 'NB-001'), new Unmapped(PRODUCT_ID)]),
    );

    await expect(append).rejects.toThrow('No integration event for Unmapped.');
    expect(await db('outbox').count({ total: '*' }).first()).toEqual({ total: '0' });
  });
});
