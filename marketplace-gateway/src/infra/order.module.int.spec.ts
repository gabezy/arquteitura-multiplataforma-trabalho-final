import { Knex } from 'knex';
import { Consumer, EachMessagePayload, Producer, TopicMessages } from 'kafkajs';
import pino from 'pino';
import { loadConfig } from './config/env';
import { createMarketplaceRegistry } from './marketplace/marketplaces.factory';
import { OutboxRelay } from './messaging/outbox-relay';
import { createOrderModule, OrderModule } from './order.factory';
import { createMigrationSource } from './persistence/migration-source';
import { createTestDatabase, TestDatabase } from './testing/test-database';
import { requestsTo, resetWiremock, simulateFailure, simulateOrder, simulatorBaseUrl } from './testing/wiremock';

const ORDER_ID = '1000001';
const CANCELLED_TOPIC = 'order.order.cancelled.v1';
const DEAD_LETTER_TOPIC = 'marketplace.order-cancelled.dlq';
const logger = pino({ level: 'silent' });

const waitUntil = async (condition: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};

// The order flow of the service with everything real but Kafka: the simulators in WireMock, the adapters
// with their resilience, the database and the outbox. The producer and the consumer are fakes.
describe('receiving and cancelling orders, end to end', () => {
  let testDatabase: TestDatabase;
  let db: Knex;
  let orderModule: OrderModule;
  const sendBatch = jest.fn();
  const send = jest.fn();
  const producer = { sendBatch, send } as unknown as Producer;
  const consumer = { connect: jest.fn(), subscribe: jest.fn(), run: jest.fn() };

  const outboxKeys = async () => (await db('outbox').orderBy('aggregate_id').pluck('aggregate_id')) as string[];
  const outboxCount = async () => Number((await db('outbox').count({ total: '*' }).first())?.total);

  const relayedMessages = () =>
    sendBatch.mock.calls.flatMap(([batch]) =>
      batch.topicMessages.flatMap((topic: TopicMessages) => topic.messages.map(message => ({ topic: topic.topic, ...message }))),
    );

  const deliverCancelled = async (value: object, headers: Record<string, string> = {}) => {
    const { eachMessage } = consumer.run.mock.calls[0][0];
    await eachMessage({
      topic: CANCELLED_TOPIC,
      partition: 0,
      message: { key: Buffer.from('k'), value: Buffer.from(JSON.stringify(value)), offset: '1', headers },
    } as unknown as EachMessagePayload);
  };

  const buildModule = (env: Record<string, string> = {}) => {
    const config = loadConfig({
      AMAZON_BASE_URL: simulatorBaseUrl('AMAZON'),
      MERCADO_LIVRE_BASE_URL: simulatorBaseUrl('MERCADO_LIVRE'),
      SHOPEE_BASE_URL: simulatorBaseUrl('SHOPEE'),
      MARKETPLACE_BACKOFF_BASE_MS: '1',
      MARKETPLACE_BACKOFF_MAX_MS: '2',
      MARKETPLACE_TIMEOUT_MS: '1000',
      ORDER_POLL_INTERVAL_MS: '20',
      ...env,
    });
    orderModule = createOrderModule({
      db,
      marketplaces: createMarketplaceRegistry(config.marketplaces, logger),
      producer,
      orderCancelledKafkaConsumer: consumer as unknown as Consumer,
      orderCancelledTopics: { topic: CANCELLED_TOPIC, deadLetterTopic: DEAD_LETTER_TOPIC },
      polling: config.orderPolling,
      logger,
    });
  };

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    db = testDatabase.db;
    await db.migrate.latest({ migrationSource: createMigrationSource() });
  });

  beforeEach(async () => {
    await resetWiremock();
    await db('outbox').truncate();
    await db('marketplace_orders').truncate();
    await db('order_cursors').truncate();
    await db('processed_events').truncate();
    jest.resetAllMocks();
  });

  afterEach(async () => {
    await orderModule?.orderPollers.stop();
  });

  afterAll(async () => {
    await testDatabase?.destroy();
  });

  describe('an order placed at each marketplace', () => {
    beforeEach(() => buildModule());

    it('reaches Kafka once, in the canonical format, keyed by marketplace and external id', async () => {
      await simulateOrder('all', { id: ORDER_ID, sku: 'NB-001', qty: 2, price: '4500' });

      orderModule.orderPollers.start();
      await waitUntil(async () => (await outboxCount()) === 3);
      await orderModule.orderPollers.stop();
      await new OutboxRelay(db, producer).relay();

      const messages = relayedMessages();
      expect(messages.map(message => message.key).sort()).toEqual([`AMAZON:${ORDER_ID}`, `MERCADO_LIVRE:${ORDER_ID}`, `SHOPEE:${ORDER_ID}`]);
      for (const message of messages) {
        const [marketplace] = String(message.key).split(':');
        expect(message.topic).toBe('marketplace.order.received.v1');
        expect(message.headers).toMatchObject({
          ce_type: 'marketplace.order.received.v1',
          ce_subject: message.key,
          ce_source: '/marketplace-gateway',
        });
        expect(JSON.parse(String(message.value))).toEqual({
          marketplace,
          externalOrderId: ORDER_ID,
          items: [{ sku: 'NB-001', quantity: 2, unitPrice: 4500 }],
          total: 9000,
          orderedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/),
        });
      }
    });

    it('is published only once, however many times the marketplace lists it', async () => {
      await simulateOrder('all', { id: ORDER_ID });

      orderModule.orderPollers.start();
      await waitUntil(async () => (await outboxCount()) === 3);
      const pollsAfterTheFirstOrders = (await requestsTo('/amazon/orders/v0/orders')).length;
      await waitUntil(async () => (await requestsTo('/amazon/orders/v0/orders')).length >= pollsAfterTheFirstOrders + 3);
      await orderModule.orderPollers.stop();

      expect(await outboxCount()).toBe(3);
      expect(await db('marketplace_orders').count({ total: '*' }).first()).toEqual({ total: '3' });
    });

    it('keeps the cursor of each marketplace moving with the polls', async () => {
      orderModule.orderPollers.start();
      await waitUntil(async () => Number((await db('order_cursors').count({ total: '*' }).first())?.total) === 3);
      await orderModule.orderPollers.stop();

      expect(await db('order_cursors').orderBy('marketplace').pluck('marketplace')).toEqual(['AMAZON', 'MERCADO_LIVRE', 'SHOPEE']);
    });

    it('publishes the orders that arrive while the service is polling', async () => {
      orderModule.orderPollers.start();
      await simulateOrder('SHOPEE', { id: 'SHP-LATE-1' });

      await waitUntil(async () => (await outboxKeys()).includes('SHOPEE:SHP-LATE-1'));
      await simulateOrder('AMAZON', { id: '701-LATE-1' });
      await waitUntil(async () => (await outboxKeys()).includes('AMAZON:701-LATE-1'));
      await orderModule.orderPollers.stop();

      expect(await outboxKeys()).toEqual(['AMAZON:701-LATE-1', 'SHOPEE:SHP-LATE-1']);
    });
  });

  describe('a marketplace that is down', () => {
    beforeEach(() => buildModule({ MARKETPLACE_BREAKER_COOLDOWN_MS: '200', MARKETPLACE_MAX_ATTEMPTS: '2', MARKETPLACE_BREAKER_FAILURES: '2' }));

    it('does not stop the others, and is polled again once it is back', async () => {
      await simulateFailure('SHOPEE', 'unavailable');
      await simulateOrder('all', { id: ORDER_ID });

      orderModule.orderPollers.start();
      await waitUntil(async () => (await outboxCount()) === 2);

      expect(await outboxKeys()).toEqual([`AMAZON:${ORDER_ID}`, `MERCADO_LIVRE:${ORDER_ID}`]);
      expect(await db('order_cursors').where({ marketplace: 'SHOPEE' }).first()).toBeUndefined();

      await simulateFailure('SHOPEE', 'off');
      await waitUntil(async () => (await outboxCount()) === 3);
      await orderModule.orderPollers.stop();

      expect(await outboxKeys()).toContain(`SHOPEE:${ORDER_ID}`);
    });
  });

  describe('a cancelled order', () => {
    beforeEach(async () => {
      buildModule();
      await orderModule.orderCancelledConsumer.start();
    });

    it('is cancelled at the marketplace the event names, once, even if the message is delivered twice', async () => {
      const event = { orderId: '6f1c2b8e-0000-4000-8000-000000000001', reason: 'OUT_OF_STOCK', marketplace: 'SHOPEE', externalOrderId: 'SHP261028A1B2C3' };

      await deliverCancelled(event, { ce_id: 'evt-1' });
      await deliverCancelled(event, { ce_id: 'evt-1' });

      const requests = await requestsTo('/shopee/api/v2/order/cancel_order');
      expect(requests).toHaveLength(1);
      expect(JSON.parse(requests[0].body)).toEqual({ order_sn: 'SHP261028A1B2C3', cancel_reason: 'OUT_OF_STOCK' });
      expect(send).not.toHaveBeenCalled();
    });

    it('goes to the dead letter topic when the marketplace refuses the cancellation', async () => {
      await deliverCancelled({ orderId: '6f1c2b8e-0000-4000-8000-000000000001', reason: 'PAYMENT_FAILED', marketplace: 'AMAZON', externalOrderId: '701-SHIPPED-1' });

      expect(send).toHaveBeenCalledTimes(1);
      const { topic, messages } = send.mock.calls[0][0];
      expect(topic).toBe(DEAD_LETTER_TOPIC);
      expect(String(messages[0].headers['dlq-reason'])).toBe('HTTP 409: InvalidInput: Order already shipped');
    });

    it('is not sent to the marketplace when the buyer cancelled it there', async () => {
      await deliverCancelled({ orderId: '6f1c2b8e-0000-4000-8000-000000000001', reason: 'MARKETPLACE_CANCELLED', marketplace: 'MERCADO_LIVRE', externalOrderId: '2000001' });

      expect(await requestsTo('/mercadolivre/orders/2000001')).toEqual([]);
    });
  });
});
