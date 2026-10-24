import { Knex } from 'knex';
import { MarketplaceOrder } from '../../core/order/model/marketplace-order.entity';
import { IntegrationEventMapper } from '../messaging/integration-event';
import { toOrderIntegrationEvent } from '../messaging/order.integration-events';
import { createTestDatabase, TestDatabase } from '../testing/test-database';
import { KnexMarketplaceOrderRepository } from './knex-marketplace-order.repository';
import { KnexOutboxRepository } from './knex-outbox.repository';
import { createMigrationSource } from './migration-source';

const ORDERED_AT = new Date('2026-10-28T13:05:00.000Z');

const order = (marketplace: 'AMAZON' | 'MERCADO_LIVRE' | 'SHOPEE' = 'MERCADO_LIVRE', externalOrderId = '2000001') =>
  MarketplaceOrder.receive({
    marketplace,
    externalOrderId,
    items: [{ sku: 'NB-001', quantity: 2, unitPrice: 4500.5 }],
    total: 9001,
    orderedAt: ORDERED_AT,
  });

describe('KnexMarketplaceOrderRepository', () => {
  let testDatabase: TestDatabase;
  let db: Knex;
  let repository: KnexMarketplaceOrderRepository;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    db = testDatabase.db;
    await db.migrate.latest({ migrationSource: createMigrationSource() });
    repository = new KnexMarketplaceOrderRepository(db, new KnexOutboxRepository(toOrderIntegrationEvent));
  });

  afterEach(async () => {
    await db('outbox').truncate();
    await db('marketplace_orders').truncate();
  });

  afterAll(async () => {
    await testDatabase?.destroy();
  });

  it('saves a new order and its marketplace.order.received.v1 event, and says it was new', async () => {
    await expect(repository.saveIfNew(order())).resolves.toBe(true);

    const rows = await db('marketplace_orders').select();
    expect(rows).toEqual([
      {
        marketplace: 'MERCADO_LIVRE',
        external_order_id: '2000001',
        items: [{ sku: 'NB-001', quantity: 2, unitPrice: 4500.5 }],
        total: '9001.00',
        ordered_at: ORDERED_AT,
        received_at: expect.any(Date),
      },
    ]);
    expect(await db('outbox').select('aggregate_type', 'aggregate_id', 'event_type', 'payload', 'published_at')).toEqual([
      {
        aggregate_type: 'MarketplaceOrder',
        aggregate_id: 'MERCADO_LIVRE:2000001',
        event_type: 'marketplace.order.received.v1',
        payload: {
          marketplace: 'MERCADO_LIVRE',
          externalOrderId: '2000001',
          items: [{ sku: 'NB-001', quantity: 2, unitPrice: 4500.5 }],
          total: 9001,
          orderedAt: '2026-10-28T13:05:00.000Z',
        },
        published_at: null,
      },
    ]);
  });

  it('saves nothing and publishes nothing for an order of the same marketplace and external id', async () => {
    await repository.saveIfNew(order());

    await expect(repository.saveIfNew(order())).resolves.toBe(false);

    expect(await db('marketplace_orders').count({ total: '*' }).first()).toEqual({ total: '1' });
    expect(await db('outbox').count({ total: '*' }).first()).toEqual({ total: '1' });
  });

  it('treats the same external id on another marketplace as another order', async () => {
    await expect(repository.saveIfNew(order('AMAZON', '1001'))).resolves.toBe(true);
    await expect(repository.saveIfNew(order('SHOPEE', '1001'))).resolves.toBe(true);

    expect(await db('outbox').orderBy('sequence').pluck('aggregate_id')).toEqual(['AMAZON:1001', 'SHOPEE:1001']);
  });

  it('publishes one event only when several polls see the same order at the same time', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => repository.saveIfNew(order())));

    expect(results.filter(isNew => isNew)).toHaveLength(1);
    expect(await db('marketplace_orders').count({ total: '*' }).first()).toEqual({ total: '1' });
    expect(await db('outbox').count({ total: '*' }).first()).toEqual({ total: '1' });
  });

  it('saves neither the order nor an event when the event cannot be recorded', async () => {
    const withoutContract: IntegrationEventMapper = event => {
      throw new Error(`No integration event for ${event.eventName}.`);
    };
    const broken = new KnexMarketplaceOrderRepository(db, new KnexOutboxRepository(withoutContract));

    await expect(broken.saveIfNew(order())).rejects.toThrow('No integration event for OrderReceived.');

    expect(await db('marketplace_orders').count({ total: '*' }).first()).toEqual({ total: '0' });
    await expect(repository.saveIfNew(order())).resolves.toBe(true);
  });
});
