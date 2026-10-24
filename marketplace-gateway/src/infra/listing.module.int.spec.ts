import http, { Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { Knex } from 'knex';
import { Consumer, EachMessagePayload, Producer, TopicMessages } from 'kafkajs';
import pino from 'pino';
import request from 'supertest';
import { loadConfig } from './config/env';
import { createApp } from './http/app';
import { createListingModule, ListingModule } from './listing.factory';
import { createMarketplaceRegistry } from './marketplace/marketplaces.factory';
import { OutboxRelay } from './messaging/outbox-relay';
import { createMigrationSource } from './persistence/migration-source';
import { createTestDatabase, TestDatabase } from './testing/test-database';
import { requestsTo, resetWiremock, simulateFailure, simulatorBaseUrl } from './testing/wiremock';

const APPROVED_TOPIC = 'catalog.product.approved.v1';
const DEAD_LETTER_TOPIC = 'marketplace.catalog-product.dlq';
const PRODUCT_ID = '0b8f2c1e-6a4d-4d1e-9a51-3f0f1b2c7d10';
const logger = pino({ level: 'silent' });

const PUBLISH_PATHS = {
  AMAZON: '/amazon/listings/2021-08-01/items/A1B2C3D4E5/NB-001',
  MERCADO_LIVRE: '/mercadolivre/items',
  SHOPEE: '/shopee/api/v2/product/add_item',
} as const;

const catalogProduct = (overrides: Record<string, unknown> = {}) => ({
  id: PRODUCT_ID,
  sku: 'NB-001',
  name: 'Notebook',
  description: 'Notebook 16GB RAM',
  price: 4500,
  stock: 2,
  analysisStatus: 'APPROVED',
  ...overrides,
});

interface ListingJson {
  id: string;
  sku: string;
  marketplace: string;
  externalListingId: string | null;
  status: string;
  price: number;
  stock: number;
  failureReason: string | null;
}

// The listing flow of the service with everything real but Kafka and the catalog: the simulators in WireMock, the
// adapters with their resilience, the database, the outbox and the API. The producer and the consumer are fakes,
// and the catalog is a small HTTP server that answers what the test says.
describe('publishing the listings of an approved product, end to end', () => {
  let testDatabase: TestDatabase;
  let db: Knex;
  let catalogServer: Server;
  let catalogUrl: string;
  let catalogAnswer: (sku: string, res: ServerResponse) => void;
  let listingModule: ListingModule;
  let app: ReturnType<typeof createApp>;
  const sendBatch = jest.fn();
  const send = jest.fn();
  const producer = { sendBatch, send } as unknown as Producer;
  const consumer = { connect: jest.fn(), subscribe: jest.fn(), run: jest.fn() };

  const answerWith = (status: number, body: unknown) => (_sku: string, res: ServerResponse) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const deliver = async (body: unknown = { productId: PRODUCT_ID, sku: 'NB-001' }, headers: Record<string, string> = {}) => {
    const { eachMessage } = consumer.run.mock.calls.at(-1)[0];
    await eachMessage({
      topic: APPROVED_TOPIC,
      partition: 0,
      message: { key: Buffer.from(PRODUCT_ID), value: Buffer.from(JSON.stringify(body)), offset: '1', headers },
    } as unknown as EachMessagePayload);
  };

  const listings = async (query = '?sku=NB-001'): Promise<ListingJson[]> => (await request(app).get(`/listings${query}`)).body.listings;

  const byMarketplace = (all: ListingJson[]) => Object.fromEntries(all.map(listing => [listing.marketplace, listing]));

  const relayedEvents = async () => {
    sendBatch.mockClear();
    await new OutboxRelay(db, producer).relay();
    return sendBatch.mock.calls.flatMap(([batch]) =>
      batch.topicMessages.flatMap((topic: TopicMessages) =>
        topic.messages.map(message => ({ topic: topic.topic, key: String(message.key), headers: message.headers, data: JSON.parse(String(message.value)) })),
      ),
    );
  };

  const buildModule = (env: Record<string, string> = {}) => {
    const config = loadConfig({
      AMAZON_BASE_URL: simulatorBaseUrl('AMAZON'),
      MERCADO_LIVRE_BASE_URL: simulatorBaseUrl('MERCADO_LIVRE'),
      SHOPEE_BASE_URL: simulatorBaseUrl('SHOPEE'),
      MARKETPLACE_BACKOFF_BASE_MS: '1',
      MARKETPLACE_BACKOFF_MAX_MS: '2',
      MARKETPLACE_TIMEOUT_MS: '2000',
      MARKETPLACE_MAX_ATTEMPTS: '2',
      MARKETPLACE_BREAKER_FAILURES: '50',
      CATALOG_SERVICE_URL: catalogUrl,
      CATALOG_TIMEOUT_MS: '2000',
      ...env,
    });
    listingModule = createListingModule({
      db,
      marketplaces: createMarketplaceRegistry(config.marketplaces, logger),
      catalog: { baseUrl: config.catalog.serviceUrl, timeoutMs: config.catalog.timeoutMs },
      producer,
      catalogProductKafkaConsumer: consumer as unknown as Consumer,
      catalogProductTopics: { approvedTopic: APPROVED_TOPIC, deadLetterTopic: DEAD_LETTER_TOPIC },
      logger,
    });
    app = createApp({ logger, checkDatabase: async () => undefined, listingController: listingModule.listingController });
  };

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    db = testDatabase.db;
    await db.migrate.latest({ migrationSource: createMigrationSource() });
    catalogServer = http.createServer((req, res) => catalogAnswer(decodeURIComponent((req.url ?? '').split('/').pop() ?? ''), res));
    await new Promise<void>(resolve => catalogServer.listen(0, '127.0.0.1', resolve));
    catalogUrl = `http://127.0.0.1:${(catalogServer.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    await resetWiremock();
    await db('outbox').truncate();
    await db('listings').truncate();
    await db('processed_events').truncate();
    jest.resetAllMocks();
    catalogAnswer = answerWith(200, catalogProduct());
    buildModule();
    await listingModule.catalogProductConsumer.start();
  });

  afterAll(async () => {
    catalogServer.closeAllConnections();
    await new Promise(resolve => catalogServer.close(resolve));
    await testDatabase?.destroy();
  });

  describe('a product the catalog approved', () => {
    it('appears published at the three simulators, with the id each one gave', async () => {
      await deliver();

      const published = byMarketplace(await listings());
      expect(Object.keys(published).sort()).toEqual(['AMAZON', 'MERCADO_LIVRE', 'SHOPEE']);
      expect(published.AMAZON).toMatchObject({ status: 'PUBLISHED', sku: 'NB-001', price: 4500, stock: 2, failureReason: null });
      expect(published.AMAZON.externalListingId).toMatch(/^B0[A-Z0-9]{8}$/);
      expect(published.MERCADO_LIVRE.externalListingId).toMatch(/^MLB\d{10}$/);
      expect(published.SHOPEE.externalListingId).toMatch(/^\d{9}$/);
      expect(Object.values(published).every(listing => listing.status === 'PUBLISHED')).toBe(true);
    });

    it('sends the id of each listing to its simulator as the idempotency key', async () => {
      await deliver();

      const published = byMarketplace(await listings());
      for (const marketplace of ['AMAZON', 'MERCADO_LIVRE', 'SHOPEE'] as const) {
        const [call, ...others] = await requestsTo(PUBLISH_PATHS[marketplace]);
        expect(others).toEqual([]);
        expect(call.headers['idempotency-key']).toBe(published[marketplace].id);
      }
    });

    it('reaches Kafka as one marketplace.listing.published.v1 per marketplace, keyed by the product', async () => {
      await deliver();

      const events = await relayedEvents();

      expect(events).toHaveLength(3);
      const published = byMarketplace(await listings());
      for (const event of events) {
        expect(event.topic).toBe('marketplace.listing.published.v1');
        expect(event.key).toBe(PRODUCT_ID);
        expect(event.headers).toMatchObject({ ce_type: 'marketplace.listing.published.v1', ce_subject: PRODUCT_ID, ce_source: '/marketplace-gateway' });
        expect(event.data).toEqual({
          productId: PRODUCT_ID,
          sku: 'NB-001',
          marketplace: expect.any(String),
          externalListingId: published[event.data.marketplace].externalListingId,
          publishedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
        });
      }
      expect(events.map(event => event.data.marketplace).sort()).toEqual(['AMAZON', 'MERCADO_LIVRE', 'SHOPEE']);
    });

    it('is looked up by the API as one listing, by its id', async () => {
      await deliver();
      const [first] = await listings('?sku=NB-001&marketplace=SHOPEE');

      const response = await request(app).get(`/listings/${first.id}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ...first, updatedAt: expect.any(String) });
    });

    it('is not published twice when the same message is delivered again', async () => {
      await deliver(undefined, { ce_id: 'evt-1' });
      await deliver(undefined, { ce_id: 'evt-1' });

      for (const marketplace of ['AMAZON', 'MERCADO_LIVRE', 'SHOPEE'] as const) {
        expect(await requestsTo(PUBLISH_PATHS[marketplace])).toHaveLength(1);
      }
      expect(await listings()).toHaveLength(3);
      expect(send).not.toHaveBeenCalled();
    });

    it('is not published again, and is not sent to the dead letter topic, when another event for it comes', async () => {
      await deliver(undefined, { ce_id: 'evt-1' });

      await deliver(undefined, { ce_id: 'evt-2' });

      for (const marketplace of ['AMAZON', 'MERCADO_LIVRE', 'SHOPEE'] as const) {
        expect(await requestsTo(PUBLISH_PATHS[marketplace])).toHaveLength(1);
      }
      expect(send).not.toHaveBeenCalled();
      expect(await relayedEvents()).toHaveLength(3);
    });

    it('does not even ask the catalog when another event comes for a product that is published everywhere', async () => {
      await deliver(undefined, { ce_id: 'evt-1' });
      catalogAnswer = answerWith(503, {});

      await expect(deliver(undefined, { ce_id: 'evt-2' })).resolves.toBeUndefined();

      expect(send).not.toHaveBeenCalled();
      expect((await listings()).map(listing => listing.status)).toEqual(['PUBLISHED', 'PUBLISHED', 'PUBLISHED']);
    });
  });

  describe('a product that a marketplace refuses', () => {
    it('ends FAILED at the three marketplaces, each with its own reason, after one attempt', async () => {
      catalogAnswer = answerWith(200, catalogProduct({ price: 0 }));

      await deliver();

      const failed = byMarketplace(await listings());
      expect(Object.values(failed).every(listing => listing.status === 'FAILED' && listing.externalListingId === null)).toBe(true);
      expect(failed.AMAZON.failureReason).toBe('HTTP 400: InvalidInput: list_price must be greater than zero');
      expect(failed.MERCADO_LIVRE.failureReason).toBe('HTTP 400: Validation error: Item price invalid');
      expect(failed.SHOPEE.failureReason).toBe('error_param: original_price must be greater than 0');
      for (const marketplace of ['AMAZON', 'MERCADO_LIVRE', 'SHOPEE'] as const) {
        expect(await requestsTo(PUBLISH_PATHS[marketplace])).toHaveLength(1);
      }
    });

    it('reaches Kafka as marketplace.listing.failed.v1, with the reason and one attempt', async () => {
      catalogAnswer = answerWith(200, catalogProduct({ price: 0 }));
      await deliver();

      const events = await relayedEvents();

      expect(events).toHaveLength(3);
      for (const event of events) {
        expect(event).toMatchObject({ topic: 'marketplace.listing.failed.v1', key: PRODUCT_ID });
        expect(event.data).toEqual({ productId: PRODUCT_ID, sku: 'NB-001', marketplace: expect.any(String), reason: expect.any(String), attempts: 1 });
      }
    });
  });

  describe('a marketplace that is down', () => {
    it('ends FAILED there, with the reason and the attempts, while the others are published', async () => {
      await simulateFailure('SHOPEE', 'unavailable');

      await expect(deliver()).resolves.toBeUndefined();

      const result = byMarketplace(await listings());
      expect(result.AMAZON.status).toBe('PUBLISHED');
      expect(result.MERCADO_LIVRE.status).toBe('PUBLISHED');
      expect(result.SHOPEE).toMatchObject({ status: 'FAILED', failureReason: 'HTTP 503', externalListingId: null });
      expect(send).not.toHaveBeenCalled();
    });

    it('is reported as one marketplace.listing.failed.v1 with the attempts, next to two published', async () => {
      await simulateFailure('SHOPEE', 'unavailable');
      await deliver();

      const events = await relayedEvents();

      expect(events.filter(event => event.topic === 'marketplace.listing.published.v1')).toHaveLength(2);
      const failed = events.filter(event => event.topic === 'marketplace.listing.failed.v1');
      expect(failed).toHaveLength(1);
      expect(failed[0].data).toEqual({ productId: PRODUCT_ID, sku: 'NB-001', marketplace: 'SHOPEE', reason: 'HTTP 503', attempts: 2 });
      expect(await requestsTo(PUBLISH_PATHS.SHOPEE)).toHaveLength(2);
    });

    it('is tried again, and only it, when the event is delivered again after it is back', async () => {
      await simulateFailure('SHOPEE', 'unavailable');
      await deliver(undefined, { ce_id: 'evt-1' });
      const [failed] = await listings('?marketplace=SHOPEE');
      await simulateFailure('SHOPEE', 'off');

      await deliver(undefined, { ce_id: 'evt-2' });

      const [recovered] = await listings('?marketplace=SHOPEE');
      expect(recovered).toMatchObject({ id: failed.id, status: 'PUBLISHED', failureReason: null });
      expect(recovered.externalListingId).toMatch(/^\d{9}$/);
      expect(await requestsTo(PUBLISH_PATHS.AMAZON)).toHaveLength(1);
      expect(await requestsTo(PUBLISH_PATHS.MERCADO_LIVRE)).toHaveLength(1);
      expect(send).not.toHaveBeenCalled();
      expect((await relayedEvents()).map(event => event.topic).sort()).toEqual([
        'marketplace.listing.failed.v1',
        'marketplace.listing.published.v1',
        'marketplace.listing.published.v1',
        'marketplace.listing.published.v1',
      ]);
    });

    it('shows the listing as PENDING while the marketplace has not answered', async () => {
      buildModule({ MARKETPLACE_TIMEOUT_MS: '1500', MARKETPLACE_MAX_ATTEMPTS: '1' });
      await listingModule.catalogProductConsumer.start();
      await simulateFailure('SHOPEE', 'slow');

      const delivery = deliver();
      const sawPending = async () => (await listings('?marketplace=SHOPEE&status=PENDING')).length === 1;
      const deadline = Date.now() + 5000;
      while (!(await sawPending())) {
        if (Date.now() > deadline) throw new Error('the listing never showed as PENDING');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      await delivery;

      const result = byMarketplace(await listings());
      expect(result.SHOPEE).toMatchObject({ status: 'FAILED', failureReason: 'SHOPEE did not answer within 1500 ms' });
      expect(result.AMAZON.status).toBe('PUBLISHED');
      expect(result.MERCADO_LIVRE.status).toBe('PUBLISHED');
    });
  });

  describe('a product the gateway cannot read from the catalog', () => {
    it.each([
      ['does not exist', answerWith(404, { title: 'Not Found' }), 'Product NB-001 not found in the catalog.'],
      ['is not approved', answerWith(200, catalogProduct({ analysisStatus: 'REJECTED' })), 'Product NB-001 is not approved'],
    ])('goes to the dead letter topic, with no listing, when the product %s', async (_case, answer, reason) => {
      catalogAnswer = answer;

      await deliver(undefined, { ce_id: 'evt-1' });

      expect(send).toHaveBeenCalledTimes(1);
      const { topic, messages } = send.mock.calls[0][0];
      expect(topic).toBe(DEAD_LETTER_TOPIC);
      expect(String(messages[0].headers['dlq-reason'])).toContain(reason);
      expect(await listings()).toEqual([]);
      for (const marketplace of ['AMAZON', 'MERCADO_LIVRE', 'SHOPEE'] as const) {
        expect(await requestsTo(PUBLISH_PATHS[marketplace])).toEqual([]);
      }
    });

    it('is delivered again, with no listing saved, when the catalog is down', async () => {
      catalogAnswer = answerWith(503, {});

      await expect(deliver(undefined, { ce_id: 'evt-1' })).rejects.toThrow('The catalog answered HTTP 503.');

      expect(await listings()).toEqual([]);
      expect(send).not.toHaveBeenCalled();
      expect(await db('processed_events').count({ total: '*' }).first()).toEqual({ total: '0' });
      for (const marketplace of ['AMAZON', 'MERCADO_LIVRE', 'SHOPEE'] as const) {
        expect(await requestsTo(PUBLISH_PATHS[marketplace])).toEqual([]);
      }
    });

    it('is published when the same message is delivered again and the catalog is back', async () => {
      catalogAnswer = answerWith(503, {});
      await deliver(undefined, { ce_id: 'evt-1' }).catch(() => undefined);
      catalogAnswer = answerWith(200, catalogProduct());

      await deliver(undefined, { ce_id: 'evt-1' });

      expect((await listings()).map(listing => listing.status)).toEqual(['PUBLISHED', 'PUBLISHED', 'PUBLISHED']);
    });
  });
});
