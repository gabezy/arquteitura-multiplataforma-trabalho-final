import knex, { Knex } from 'knex';
import { context, propagation, ROOT_CONTEXT, trace, TraceFlags } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { KnexOutboxRepository } from './knex-outbox.repository';
import { createMigrationSource } from './migration-source';
import { DomainEvent } from '../../core/shared/domain/domain.event';
import { IntegrationEventMapper } from '../messaging/integration-event';

const POSTGRES_IMAGE = 'postgres:18-alpine';
const CONTAINER_STARTUP_MS = 60_000;
const ORDER_ID = '6f1c2a4e-8b3d-4c5f-9a7e-1d2b3c4d5e6f';
const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const SPAN_ID = 'b7ad6b7169203331';

class OrderPlaced extends DomainEvent {
  readonly eventName = 'OrderPlaced';

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
  if (event instanceof OrderPlaced) {
    return { type: 'order.order.placed.v1', data: { orderId: event.aggregateId, sku: event.sku } };
  }
  throw new Error(`No integration event for ${event.eventName}.`);
};

describe('KnexOutboxRepository', () => {
  let container: StartedPostgreSqlContainer;
  let db: Knex;
  const outbox = new KnexOutboxRepository(toIntegrationEvent);

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    db = knex({ client: 'pg', connection: container.getConnectionUri() });
    await db.migrate.latest({ migrationSource: createMigrationSource() });
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  }, CONTAINER_STARTUP_MS);

  afterEach(async () => {
    await db('outbox').truncate();
  });

  afterAll(async () => {
    context.disable();
    propagation.disable();
    await db?.destroy();
    await container?.stop();
  });

  it('stores one pending row per event with its public type, data and the active trace context', async () => {
    const event = new OrderPlaced(ORDER_ID, 'SKU-001');
    const spanContext = { traceId: TRACE_ID, spanId: SPAN_ID, traceFlags: TraceFlags.SAMPLED };

    await context.with(trace.setSpanContext(ROOT_CONTEXT, spanContext), () =>
      db.transaction(tx => outbox.append(tx, 'Order', [event])),
    );

    const rows = await db('outbox').select();
    expect(rows).toEqual([
      {
        sequence: expect.any(String),
        event_id: event.eventId,
        aggregate_type: 'Order',
        aggregate_id: ORDER_ID,
        event_type: 'order.order.placed.v1',
        payload: { orderId: ORDER_ID, sku: 'SKU-001' },
        headers: { traceparent: `00-${TRACE_ID}-${SPAN_ID}-01` },
        occurred_at: event.occurredOn,
        published_at: null,
      },
    ]);
  });

  it('writes no row when one event of the transaction has no mapping', async () => {
    const append = db.transaction(tx =>
      outbox.append(tx, 'Order', [new OrderPlaced(ORDER_ID, 'SKU-001'), new Unmapped(ORDER_ID)]),
    );

    await expect(append).rejects.toThrow('No integration event for Unmapped.');
    expect(await db('outbox').count({ total: '*' }).first()).toEqual({ total: '0' });
  });
});
