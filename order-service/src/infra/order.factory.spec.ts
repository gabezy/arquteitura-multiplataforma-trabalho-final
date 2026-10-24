import knex, { Knex } from 'knex';
import pino from 'pino';
import request from 'supertest';
import { Consumer, EachMessagePayload, Producer } from 'kafkajs';
import { context, propagation } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createApp } from './http/app';
import { createOrderModule, OrderModule } from './order.factory';
import { createMigrationSource } from './persistence/migration-source';

const POSTGRES_IMAGE = 'postgres:18-alpine';
const CONTAINER_STARTUP_MS = 60_000;
const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const logger = pino({ level: 'silent' });

const RECEIVED = {
  marketplace: 'SHOPEE',
  externalOrderId: 'SHP261028A1B2C3',
  items: [{ sku: 'NB-001', quantity: 2, unitPrice: 4500 }],
  total: 9000,
  orderedAt: '2026-10-28T13:05:00.000Z',
};

// The order module wired as main.ts wires it, with a real Postgres and fake Kafka clients.
describe('order module', () => {
  let container: StartedPostgreSqlContainer;
  let db: Knex;
  let orderModule: OrderModule;
  const consumer = { connect: jest.fn(), subscribe: jest.fn(), run: jest.fn() };
  const producer = { send: jest.fn() };

  const deliver = async (headers: Record<string, string>) => {
    const { eachMessage } = consumer.run.mock.calls[0][0];
    await eachMessage({
      topic: 'marketplace.order.received.v1',
      partition: 0,
      message: { key: Buffer.from('SHOPEE:SHP261028A1B2C3'), value: Buffer.from(JSON.stringify(RECEIVED)), offset: '1', headers },
    } as unknown as EachMessagePayload);
  };

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    db = knex({ client: 'pg', connection: container.getConnectionUri() });
    await db.migrate.latest({ migrationSource: createMigrationSource() });
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());

    orderModule = createOrderModule({
      db,
      producer: producer as unknown as Producer,
      marketplaceOrderKafkaConsumer: consumer as unknown as Consumer,
      logger,
    });
    await orderModule.marketplaceOrderConsumer.start();
  }, CONTAINER_STARTUP_MS);

  afterAll(async () => {
    context.disable();
    propagation.disable();
    await db?.destroy();
    await container?.stop();
  });

  it('subscribes the consumer to marketplace.order.received.v1', () => {
    expect(consumer.subscribe).toHaveBeenCalledWith({ topics: ['marketplace.order.received.v1'], fromBeginning: true });
  });

  it('turns a received message into an order and a placed event in the trace of the message, once', async () => {
    const headers = { ce_id: 'ce-1', traceparent: `00-${TRACE_ID}-00f067aa0ba902b7-01` };

    await deliver(headers);
    await deliver(headers);
    await deliver({ ...headers, ce_id: 'ce-2' });

    const orders = await db('orders').select('id', 'marketplace', 'external_order_id', 'status', 'total');
    expect(orders).toEqual([{ id: expect.any(String), marketplace: 'SHOPEE', external_order_id: 'SHP261028A1B2C3', status: 'RECEIVED', total: '9000.00' }]);

    const outbox = await db('outbox').select('aggregate_id', 'event_type', 'headers', 'payload');
    expect(outbox).toEqual([{
      aggregate_id: orders[0].id,
      event_type: 'order.order.placed.v1',
      headers: { traceparent: expect.stringMatching(new RegExp(`^00-${TRACE_ID}-`)) },
      payload: expect.objectContaining({ orderId: orders[0].id, items: [{ sku: 'NB-001', quantity: 2, unitPrice: 4500 }] }),
    }]);
    expect(producer.send).not.toHaveBeenCalled();
  });

  it('serves the stored order through the HTTP routes', async () => {
    const app = createApp({ logger, checkDatabase: async () => undefined, orderRoutes: orderModule.orderRoutes });
    const [{ id }] = await db('orders').select('id');

    const list = await request(app).get('/orders?marketplace=SHOPEE');
    const detail = await request(app).get(`/orders/${id}`);

    expect(list.status).toBe(200);
    expect(list.body.orders.map((order: { id: string }) => order.id)).toEqual([id]);
    expect(detail.status).toBe(200);
    expect(detail.body).toEqual(expect.objectContaining({ id, status: 'RECEIVED', total: 9000, cancellationReason: null }));
  });
});
