import knex, { Knex } from 'knex';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Order, ReceiveOrderProps } from '../../core/order/model/order.entity';
import { IntegrationEventMapper } from '../messaging/integration-event';
import { toOrderIntegrationEvent } from '../messaging/order.integration-events';
import { KnexOrderRepository } from './knex-order.repository';
import { KnexOutboxRepository } from './knex-outbox.repository';
import { createMigrationSource } from './migration-source';

const POSTGRES_IMAGE = 'postgres:18-alpine';
const CONTAINER_STARTUP_MS = 60_000;
const ORDERED_AT = new Date('2026-10-28T13:05:00Z');

const receive = (overrides: Partial<ReceiveOrderProps> = {}): Order =>
  Order.receive({
    marketplace: 'AMAZON',
    externalOrderId: 'AMZ-1000002',
    items: [
      { sku: 'OXI-001', quantity: 1, unitPrice: 189.9 },
      { sku: 'MON-002', quantity: 1, unitPrice: 18500 },
      { sku: 'BRINDE-01', quantity: 1, unitPrice: 0 },
    ],
    orderedAt: ORDERED_AT,
    ...overrides,
  });

const count = async (db: Knex, table: string): Promise<number> => Number((await db(table).count({ total: '*' }).first())?.total);

describe('KnexOrderRepository', () => {
  let container: StartedPostgreSqlContainer;
  let db: Knex;
  let repository: KnexOrderRepository;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    db = knex({ client: 'pg', connection: container.getConnectionUri() });
    await db.migrate.latest({ migrationSource: createMigrationSource() });
    repository = new KnexOrderRepository(db, new KnexOutboxRepository(toOrderIntegrationEvent));
  }, CONTAINER_STARTUP_MS);

  afterEach(async () => {
    await db.raw('truncate orders, order_items, processed_events, outbox');
  });

  afterAll(async () => {
    await db?.destroy();
    await container?.stop();
  });

  describe('saveReceived', () => {
    it('writes the order, its items, the inbox row and one placed event in the outbox', async () => {
      const order = receive();

      expect(await repository.saveReceived(order, 'ce-1')).toBe(true);

      expect(await db('orders').select()).toEqual([{
        id: order.id.value,
        marketplace: 'AMAZON',
        external_order_id: 'AMZ-1000002',
        status: 'RECEIVED',
        total: '18689.90',
        cancellation_reason: null,
        ordered_at: ORDERED_AT,
        created_at: order.createdAt,
        updated_at: order.updatedAt,
      }]);
      expect(await db('order_items').orderBy('line').select()).toEqual([
        { order_id: order.id.value, line: 1, sku: 'OXI-001', quantity: 1, unit_price: '189.90' },
        { order_id: order.id.value, line: 2, sku: 'MON-002', quantity: 1, unit_price: '18500.00' },
        { order_id: order.id.value, line: 3, sku: 'BRINDE-01', quantity: 1, unit_price: '0.00' },
      ]);
      expect(await db('processed_events').select('event_id', 'event_type')).toEqual([
        { event_id: 'ce-1', event_type: 'marketplace.order.received.v1' },
      ]);
      expect(await db('outbox').select('aggregate_type', 'aggregate_id', 'event_type', 'payload')).toEqual([{
        aggregate_type: 'Order',
        aggregate_id: order.id.value,
        event_type: 'order.order.placed.v1',
        payload: {
          orderId: order.id.value,
          marketplace: 'AMAZON',
          externalOrderId: 'AMZ-1000002',
          items: [
            { sku: 'OXI-001', quantity: 1, unitPrice: 189.9 },
            { sku: 'MON-002', quantity: 1, unitPrice: 18500 },
            { sku: 'BRINDE-01', quantity: 1, unitPrice: 0 },
          ],
        },
      }]);
    });

    it('writes no inbox row when the message has no event id', async () => {
      expect(await repository.saveReceived(receive())).toBe(true);

      expect(await count(db, 'orders')).toBe(1);
      expect(await count(db, 'processed_events')).toBe(0);
    });

    it('keeps the stored order and records only the new event id when the marketplace order exists', async () => {
      const first = receive();
      await repository.saveReceived(first, 'ce-1');

      const again = receive({ items: [{ sku: 'OTHER', quantity: 9, unitPrice: 1 }] });
      expect(await repository.saveReceived(again, 'ce-2')).toBe(false);

      expect(await db('orders').pluck('id')).toEqual([first.id.value]);
      expect(await db('order_items').pluck('sku')).not.toContain('OTHER');
      expect(await db('processed_events').orderBy('event_id').pluck('event_id')).toEqual(['ce-1', 'ce-2']);
      expect(await count(db, 'outbox')).toBe(1);
    });

    it('accepts the same external id on another marketplace', async () => {
      await repository.saveReceived(receive({ marketplace: 'AMAZON' }));

      expect(await repository.saveReceived(receive({ marketplace: 'SHOPEE' }))).toBe(true);

      expect(await count(db, 'orders')).toBe(2);
    });

    it('keeps one order and one placed event when the same marketplace order is saved concurrently', async () => {
      const results = await Promise.all([receive(), receive(), receive()].map((order, i) => repository.saveReceived(order, `ce-${i}`)));

      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await count(db, 'orders')).toBe(1);
      expect(await count(db, 'outbox')).toBe(1);
    });

    it('rejects a second order for the same marketplace order at the database', async () => {
      const row = { marketplace: 'AMAZON', external_order_id: 'AMZ-1', status: 'RECEIVED', total: 1, ordered_at: ORDERED_AT, created_at: ORDERED_AT, updated_at: ORDERED_AT };
      await db('orders').insert({ id: '6f1c2b8e-0000-4000-8000-000000000001', ...row });

      await expect(db('orders').insert({ id: '6f1c2b8e-0000-4000-8000-000000000002', ...row })).rejects.toThrow(/unique/);
    });

    it('writes nothing when the outbox append fails', async () => {
      const failing: IntegrationEventMapper = () => { throw new Error('No integration event for OrderPlaced.'); };
      const broken = new KnexOrderRepository(db, new KnexOutboxRepository(failing));

      await expect(broken.saveReceived(receive(), 'ce-1')).rejects.toThrow('No integration event for OrderPlaced.');

      expect(await count(db, 'orders')).toBe(0);
      expect(await count(db, 'order_items')).toBe(0);
      expect(await count(db, 'processed_events')).toBe(0);
      expect(await count(db, 'outbox')).toBe(0);
    });
  });

  describe('findById', () => {
    it('returns the stored order with all its fields and its items in line order', async () => {
      const order = receive();
      await repository.saveReceived(order);

      const found = await repository.findById(order.id.value);

      expect(found).not.toBeNull();
      expect(found!.id.value).toBe(order.id.value);
      expect(found!.marketplace).toBe('AMAZON');
      expect(found!.externalOrderId).toBe('AMZ-1000002');
      expect(found!.status).toBe('RECEIVED');
      expect(found!.cancellationReason).toBeNull();
      expect(found!.total.toReais()).toBe(18689.9);
      expect(found!.orderedAt).toEqual(ORDERED_AT);
      expect(found!.createdAt).toEqual(order.createdAt);
      expect(found!.updatedAt).toEqual(order.updatedAt);
      expect(found!.items.map(({ sku, quantity, unitPrice }) => ({ sku, quantity, unitPrice: unitPrice.toReais() }))).toEqual([
        { sku: 'OXI-001', quantity: 1, unitPrice: 189.9 },
        { sku: 'MON-002', quantity: 1, unitPrice: 18500 },
        { sku: 'BRINDE-01', quantity: 1, unitPrice: 0 },
      ]);
      expect(found!.pullDomainEvents()).toEqual([]);
    });

    it('returns null for an unknown id', async () => {
      expect(await repository.findById('6f1c2b8e-0000-4000-8000-000000000009')).toBeNull();
    });
  });

  describe('list', () => {
    const at = (iso: string) => new Date(iso);

    // Stored through SQL so created_at and the ids are fixed: AMAZON/RECEIVED at 10h, SHOPEE/CANCELLED at 11h
    // and two at 12h (MERCADO_LIVRE/RECEIVED with id ...0a, AMAZON/PAID with id ...0b).
    beforeEach(async () => {
      const row = (id: string, marketplace: string, status: string, createdAt: string) => ({
        id: `6f1c2b8e-0000-4000-8000-0000000000${id}`,
        marketplace,
        external_order_id: `EXT-${id}`,
        status,
        total: 10,
        cancellation_reason: status === 'CANCELLED' ? 'OUT_OF_STOCK' : null,
        ordered_at: at(createdAt),
        created_at: at(createdAt),
        updated_at: at(createdAt),
      });
      const orders = [
        row('01', 'AMAZON', 'RECEIVED', '2026-10-28T10:00:00Z'),
        row('02', 'SHOPEE', 'CANCELLED', '2026-10-28T11:00:00Z'),
        row('0a', 'MERCADO_LIVRE', 'RECEIVED', '2026-10-28T12:00:00Z'),
        row('0b', 'AMAZON', 'PAID', '2026-10-28T12:00:00Z'),
      ];
      await db('orders').insert(orders);
      await db('order_items').insert(orders.map(({ id }) => ({ order_id: id, line: 1, sku: 'NB-001', quantity: 1, unit_price: 10 })));
    });

    const ids = (orders: Order[]) => orders.map(order => order.id.value.slice(-2));

    it('returns the newest first, with the id descending for the same creation time', async () => {
      expect(ids(await repository.list({}, { limit: 20, offset: 0 }))).toEqual(['0b', '0a', '02', '01']);
    });

    it('returns only the orders of the marketplace, of the status, or of both', async () => {
      expect(ids(await repository.list({ marketplace: 'AMAZON' }, { limit: 20, offset: 0 }))).toEqual(['0b', '01']);
      expect(ids(await repository.list({ status: 'RECEIVED' }, { limit: 20, offset: 0 }))).toEqual(['0a', '01']);
      expect(ids(await repository.list({ marketplace: 'AMAZON', status: 'PAID' }, { limit: 20, offset: 0 }))).toEqual(['0b']);
    });

    it('reads the cancellation reason and the items of each order', async () => {
      const [cancelled] = await repository.list({ status: 'CANCELLED' }, { limit: 20, offset: 0 });

      expect(cancelled.cancellationReason).toBe('OUT_OF_STOCK');
      expect(cancelled.items.map(({ sku, quantity, unitPrice }) => ({ sku, quantity, unitPrice: unitPrice.toReais() }))).toEqual([
        { sku: 'NB-001', quantity: 1, unitPrice: 10 },
      ]);
    });

    it('pages through the orders with limit and offset', async () => {
      expect(ids(await repository.list({}, { limit: 2, offset: 0 }))).toEqual(['0b', '0a']);
      expect(ids(await repository.list({}, { limit: 2, offset: 2 }))).toEqual(['02', '01']);
    });

    it('returns an empty list for an offset past the last order', async () => {
      expect(await repository.list({}, { limit: 20, offset: 4 })).toEqual([]);
    });
  });
});
