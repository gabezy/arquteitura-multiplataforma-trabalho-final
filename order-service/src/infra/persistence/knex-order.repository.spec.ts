import knex, { Knex } from 'knex';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Marketplace } from '../../core/order/model/marketplace.vo';
import { OrderStatus } from '../../core/order/model/order-status.vo';
import { Order, OrderSnapshot } from '../../core/order/model/order.entity';
import { OrderCancelled, OrderConfirmed, OrderPlaced } from '../../core/order/model/order.events';
import { Id } from '../../core/shared/domain/id';
import { IntegrationEventMapper } from '../messaging/integration-event';
import { ConcurrentModificationError } from './concurrent-modification.error';
import { KnexOrderRepository } from './knex-order.repository';
import { KnexOutboxRepository } from './knex-outbox.repository';
import { createMigrationSource } from './migration-source';

const POSTGRES_IMAGE = 'postgres:18-alpine';
const CONTAINER_STARTUP_MS = 60_000;
const ORDERED_AT = new Date('2026-10-28T13:05:00Z');
const NOW = new Date('2026-10-28T13:05:02Z');
const LATER = new Date('2026-10-28T13:05:09Z');

// The public types are the business of the mapper of the service; here only that every event is stored.
const toIntegrationEvent: IntegrationEventMapper = event => {
  if (event instanceof OrderPlaced) return { type: 'order.order.placed.v1', data: { orderId: event.aggregateId } };
  if (event instanceof OrderConfirmed) return { type: 'order.order.confirmed.v1', data: { orderId: event.aggregateId } };
  if (event instanceof OrderCancelled) return { type: 'order.order.cancelled.v1', data: { orderId: event.aggregateId } };
  throw new Error(`No integration event for ${event.eventName}.`);
};

const received = (externalOrderId = 'ML-2000001', marketplace = 'MERCADO_LIVRE'): Order =>
  Order.receive({
    marketplace,
    externalOrderId,
    items: [
      { sku: 'IPHONE-15', quantity: 2, unitPrice: 4500.5 },
      { sku: 'CASE-01', quantity: 3, unitPrice: 19.99 },
    ],
    total: 9060.97,
    orderedAt: ORDERED_AT,
  }, NOW);

let sequence = 0;
const snapshot = (overrides: Partial<OrderSnapshot> = {}): OrderSnapshot => ({
  id: crypto.randomUUID(),
  marketplace: 'MERCADO_LIVRE',
  externalOrderId: `EXT-${++sequence}`,
  status: 'CONFIRMED',
  totalCents: 1_500_000,
  cancellationReason: null,
  items: [{ sku: 'IPHONE-15', quantity: 1, unitPriceCents: 1_500_000 }],
  orderedAt: ORDERED_AT,
  updatedAt: NOW,
  version: 0,
  ...overrides,
});

describe('KnexOrderRepository', () => {
  let container: StartedPostgreSqlContainer;
  let db: Knex;
  let repository: KnexOrderRepository;

  const outboxRows = () => db('outbox').select('event_type', 'aggregate_type', 'aggregate_id', 'published_at').orderBy('sequence');
  const store = (...snapshots: OrderSnapshot[]) => Promise.all(snapshots.map(s => repository.saveNew(Order.restore(s))));

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    db = knex({ client: 'pg', connection: container.getConnectionUri() });
    await db.migrate.latest({ migrationSource: createMigrationSource() });
    repository = new KnexOrderRepository(db, new KnexOutboxRepository(toIntegrationEvent));
  }, CONTAINER_STARTUP_MS);

  afterEach(async () => {
    await db('orders').truncate();
    await db('outbox').truncate();
    await db('processed_events').truncate();
  });

  afterAll(async () => {
    await db?.destroy();
    await container?.stop();
  });

  describe('saveNew', () => {
    it('stores a new order that is read back with its items, its money in cents and its dates', async () => {
      const order = received();

      await repository.saveNew(order);

      const stored = await repository.findById(order.id);
      expect(stored?.id.value).toBe(order.id.value);
      expect(stored?.marketplace).toBe(Marketplace.MERCADO_LIVRE);
      expect(stored?.externalOrderId).toBe('ML-2000001');
      expect(stored?.status).toBe(OrderStatus.RECEIVED);
      expect(stored?.cancellationReason).toBeNull();
      expect(stored?.total.value).toBe(906_097);
      expect(stored?.items.map(item => item.value)).toEqual([
        { sku: 'IPHONE-15', quantity: 2, unitPriceCents: 450_050 },
        { sku: 'CASE-01', quantity: 3, unitPriceCents: 1999 },
      ]);
      expect(stored?.orderedAt).toEqual(ORDERED_AT);
      expect(stored?.updatedAt).toEqual(NOW);
      expect(stored?.version).toBe(0);
      expect(stored?.pullDomainEvents()).toEqual([]);
    });

    it('keeps an amount larger than a 32-bit integer exactly', async () => {
      const order = Order.restore(snapshot({
        totalCents: 100_000_000_000_000,
        items: Array.from({ length: 100 }, (_, i) => ({ sku: `SKU-${i}`, quantity: 10_000, unitPriceCents: 100_000_000 })),
      }));

      await repository.saveNew(order);

      expect((await repository.findById(order.id))?.total.value).toBe(100_000_000_000_000);
    });

    it('appends the events of the order to the outbox in the same transaction, pending', async () => {
      const order = received();

      await repository.saveNew(order);

      expect(await outboxRows()).toEqual([
        { event_type: 'order.order.placed.v1', aggregate_type: 'Order', aggregate_id: order.id.value, published_at: null },
      ]);
      expect(order.pullDomainEvents()).toEqual([]);
    });

    it('ignores a marketplace order that already exists, keeping the first and its event only', async () => {
      const first = received();
      const saved = await repository.saveNew(first);

      const duplicate = await repository.saveNew(received());

      expect(saved).toEqual({ orderId: first.id.value, created: true });
      expect(duplicate).toEqual({ orderId: first.id.value, created: false });
      expect(await db('orders').pluck('id')).toEqual([first.id.value]);
      expect(await outboxRows()).toHaveLength(1);
    });

    it('stores the consumed event id with the order and outbox event in one transaction', async () => {
      const order = received();

      await repository.saveNew(order, 'marketplace-event-1');

      expect(await db('processed_events').where({ event_id: 'marketplace-event-1' }).pluck('event_type'))
        .toEqual(['marketplace.order.received.v1']);
      expect(await outboxRows()).toHaveLength(1);
    });

    it('stores two orders with the same external order id on different marketplaces', async () => {
      await repository.saveNew(received('ORDER-1', 'AMAZON'));
      await repository.saveNew(received('ORDER-1', 'SHOPEE'));

      expect(await db('orders').count({ total: '*' }).first()).toEqual({ total: '2' });
    });

    it('lets only one of two deliveries of the same marketplace order win when they run at the same time', async () => {
      const results = await Promise.all([repository.saveNew(received()), repository.saveNew(received())]);

      expect(results.filter(result => result.created)).toHaveLength(1);
      expect(results.filter(result => !result.created)).toHaveLength(1);
      expect(await db('orders').count({ total: '*' }).first()).toEqual({ total: '1' });
      expect(await outboxRows()).toHaveLength(1);
    });

    it('saves nothing when an event cannot be written to the outbox', async () => {
      const unmapped = new KnexOrderRepository(db, new KnexOutboxRepository(() => { throw new Error('No integration event.'); }));

      await expect(unmapped.saveNew(received())).rejects.toThrow('No integration event.');

      expect(await db('orders').count({ total: '*' }).first()).toEqual({ total: '0' });
    });
  });

  describe('find', () => {
    it('finds an order by its marketplace and external order id, and not by another marketplace', async () => {
      const order = received('ML-2000001', 'MERCADO_LIVRE');
      await repository.saveNew(order);

      expect((await repository.findByExternalId(Marketplace.MERCADO_LIVRE, 'ML-2000001'))?.id.value).toBe(order.id.value);
      expect(await repository.findByExternalId(Marketplace.SHOPEE, 'ML-2000001')).toBeNull();
      expect(await repository.findByExternalId(Marketplace.MERCADO_LIVRE, 'ML-2000002')).toBeNull();
    });

    it('answers null for an id nobody has', async () => {
      expect(await repository.findById(new Id('6f1c2b8e-0000-4000-8000-0000000000ff'))).toBeNull();
    });
  });

  describe('save', () => {
    it('writes the new state, its reason and time, raises the version and appends the events of the change', async () => {
      const order = received();
      await repository.saveNew(order);
      const read = (await repository.findById(order.id))!;
      read.confirm(LATER);
      read.cancelForPayment(LATER);

      await repository.save(read);

      const stored = (await repository.findById(order.id))!;
      expect(stored.status).toBe(OrderStatus.CANCELLED);
      expect(stored.cancellationReason?.value).toBe('PAYMENT_FAILED');
      expect(stored.updatedAt).toEqual(LATER);
      expect(stored.version).toBe(1);
      expect(stored.total.value).toBe(906_097);
      expect(stored.items).toHaveLength(2);
      expect((await outboxRows()).map(row => row.event_type)).toEqual([
        'order.order.placed.v1', 'order.order.confirmed.v1', 'order.order.cancelled.v1',
      ]);
    });

    it('saves a change that publishes nothing, as the payment confirmed', async () => {
      await store(snapshot({ id: '6f1c2b8e-0000-4000-8000-000000000001' }));
      const read = (await repository.findById(new Id('6f1c2b8e-0000-4000-8000-000000000001')))!;
      read.markPaid(LATER);

      await repository.save(read);

      expect((await repository.findById(read.id))?.status).toBe(OrderStatus.PAID);
      expect(await outboxRows()).toEqual([]);
    });

    it('fails with a ConcurrentModificationError when the order changed since it was read, saving nothing', async () => {
      const order = received();
      await repository.saveNew(order);
      const stale = (await repository.findById(order.id))!;
      const fresh = (await repository.findById(order.id))!;
      fresh.confirm(LATER);
      await repository.save(fresh);
      stale.cancelForStock(LATER);

      await expect(repository.save(stale)).rejects.toThrow(ConcurrentModificationError);

      expect((await repository.findById(order.id))?.status).toBe(OrderStatus.CONFIRMED);
      expect((await outboxRows()).map(row => row.event_type)).toEqual(['order.order.placed.v1', 'order.order.confirmed.v1']);
    });

    it('lets only one of two outcomes read from the same version win when they are saved at the same time', async () => {
      const order = received();
      await repository.saveNew(order);
      const confirming = (await repository.findById(order.id))!;
      const cancelling = (await repository.findById(order.id))!;
      confirming.confirm(LATER);
      cancelling.cancelForStock(LATER);

      const results = await Promise.allSettled([repository.save(confirming), repository.save(cancelling)]);

      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      const failure = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
      expect(failure.reason).toBeInstanceOf(ConcurrentModificationError);
      expect((await outboxRows()).filter(row => row.event_type !== 'order.order.placed.v1')).toHaveLength(1);
    });

    it('fails with a ConcurrentModificationError for an order that does not exist', async () => {
      const ghost = Order.restore(snapshot());
      ghost.markPaid(LATER);

      await expect(repository.save(ghost)).rejects.toThrow(ConcurrentModificationError);
    });
  });

  describe('list', () => {
    const at = (iso: string) => new Date(iso);

    it('lists the newest sale first, and the larger id first among sales at the same time', async () => {
      await store(
        snapshot({ id: '00000000-0000-4000-8000-00000000000a', orderedAt: at('2026-10-27T10:00:00Z') }),
        snapshot({ id: '00000000-0000-4000-8000-00000000000b', orderedAt: at('2026-10-29T10:00:00Z') }),
        snapshot({ id: '00000000-0000-4000-8000-00000000000c', orderedAt: at('2026-10-28T10:00:00Z') }),
        snapshot({ id: '00000000-0000-4000-8000-00000000000d', orderedAt: at('2026-10-28T10:00:00Z') }),
      );

      const orders = await repository.list({ limit: 20, offset: 0 });

      expect(orders.map(order => order.id.value.slice(-1))).toEqual(['b', 'd', 'c', 'a']);
    });

    it('filters by marketplace, by status and by both', async () => {
      await store(
        snapshot({ id: '00000000-0000-4000-8000-000000000001', marketplace: 'AMAZON', status: 'PAID' }),
        snapshot({ id: '00000000-0000-4000-8000-000000000002', marketplace: 'AMAZON', status: 'CONFIRMED' }),
        snapshot({ id: '00000000-0000-4000-8000-000000000003', marketplace: 'SHOPEE', status: 'PAID' }),
        snapshot({ id: '00000000-0000-4000-8000-000000000004', marketplace: 'SHOPEE', status: 'CANCELLED', cancellationReason: 'OUT_OF_STOCK' }),
      );
      const ids = async (filter: { marketplace?: Marketplace; status?: OrderStatus }) =>
        (await repository.list({ ...filter, limit: 20, offset: 0 })).map(order => order.id.value.slice(-1)).sort();

      expect(await ids({ marketplace: Marketplace.AMAZON })).toEqual(['1', '2']);
      expect(await ids({ status: OrderStatus.PAID })).toEqual(['1', '3']);
      expect(await ids({ marketplace: Marketplace.SHOPEE, status: OrderStatus.PAID })).toEqual(['3']);
      expect(await ids({ marketplace: Marketplace.AMAZON, status: OrderStatus.CANCELLED })).toEqual([]);
      expect(await ids({})).toEqual(['1', '2', '3', '4']);
    });

    it('pages with limit and offset, and answers an empty page past the end', async () => {
      await store(...[1, 2, 3, 4, 5].map(n => snapshot({
        id: `00000000-0000-4000-8000-00000000000${n}`,
        orderedAt: at(`2026-10-2${n}T10:00:00Z`),
      })));

      const page = (limit: number, offset: number) => repository.list({ limit, offset }).then(orders => orders.map(order => order.id.value.slice(-1)));

      expect(await page(2, 0)).toEqual(['5', '4']);
      expect(await page(2, 2)).toEqual(['3', '2']);
      expect(await page(2, 4)).toEqual(['1']);
      expect(await page(2, 6)).toEqual([]);
    });

    it('reads the cancellation reason of the orders it lists', async () => {
      await store(snapshot({ status: 'CANCELLED', cancellationReason: 'PAYMENT_FAILED' }));

      const [order] = await repository.list({ limit: 1, offset: 0 });

      expect(order.cancellationReason?.value).toBe('PAYMENT_FAILED');
    });
  });

  describe('salesByMarketplace', () => {
    const period = (from: string, to: string, statuses = [OrderStatus.CONFIRMED, OrderStatus.PAID]) =>
      ({ fromInclusive: new Date(from), toExclusive: new Date(to), statuses });

    it('adds up orders, units and cents by marketplace, counting only the statuses asked', async () => {
      await store(
        snapshot({ marketplace: 'MERCADO_LIVRE', status: 'CONFIRMED', orderedAt: new Date('2026-10-28T10:00:00Z') }),
        snapshot({
          marketplace: 'MERCADO_LIVRE', status: 'PAID', orderedAt: new Date('2026-10-28T20:00:00Z'), totalCents: 35_000,
          items: [{ sku: 'A', quantity: 2, unitPriceCents: 10_000 }, { sku: 'B', quantity: 3, unitPriceCents: 5000 }],
        }),
        snapshot({ marketplace: 'MERCADO_LIVRE', status: 'CANCELLED', cancellationReason: 'OUT_OF_STOCK', orderedAt: new Date('2026-10-28T11:00:00Z') }),
        snapshot({ marketplace: 'MERCADO_LIVRE', status: 'RECEIVED', orderedAt: new Date('2026-10-28T12:00:00Z') }),
        snapshot({
          marketplace: 'SHOPEE', status: 'PAID', orderedAt: new Date('2026-10-28T13:00:00Z'), totalCents: 250,
          items: [{ sku: 'A', quantity: 1, unitPriceCents: 250 }],
        }),
      );

      const sales = await repository.salesByMarketplace(period('2026-10-28T00:00:00Z', '2026-10-29T00:00:00Z'));

      expect(sales).toEqual([
        { marketplace: 'MERCADO_LIVRE', orders: 2, units: 6, totalCents: 1_535_000 },
        { marketplace: 'SHOPEE', orders: 1, units: 1, totalCents: 250 },
      ]);
    });

    it('counts the instant the period starts and leaves out the instant it ends', async () => {
      await store(
        snapshot({ marketplace: 'AMAZON', orderedAt: new Date('2026-10-27T23:59:59.999Z') }),
        snapshot({ marketplace: 'AMAZON', orderedAt: new Date('2026-10-28T00:00:00.000Z') }),
        snapshot({ marketplace: 'AMAZON', orderedAt: new Date('2026-10-28T23:59:59.999Z') }),
        snapshot({ marketplace: 'AMAZON', orderedAt: new Date('2026-10-29T00:00:00.000Z') }),
      );

      const sales = await repository.salesByMarketplace(period('2026-10-28T00:00:00Z', '2026-10-29T00:00:00Z'));

      expect(sales).toEqual([{ marketplace: 'AMAZON', orders: 2, units: 2, totalCents: 3_000_000 }]);
    });

    it('answers no row for a marketplace without sales, and nothing for an empty period', async () => {
      await store(snapshot({ marketplace: 'AMAZON', orderedAt: new Date('2026-10-28T10:00:00Z') }));

      expect(await repository.salesByMarketplace(period('2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z'))).toEqual([]);
      expect((await repository.salesByMarketplace(period('2026-10-28T00:00:00Z', '2026-10-29T00:00:00Z'))).map(row => row.marketplace)).toEqual(['AMAZON']);
    });

    it('counts only the statuses it is asked for', async () => {
      await store(
        snapshot({ marketplace: 'AMAZON', status: 'RECEIVED' }),
        snapshot({ marketplace: 'AMAZON', status: 'PAID' }),
      );

      const onlyReceived = await repository.salesByMarketplace(period('2026-10-28T00:00:00Z', '2026-10-29T00:00:00Z', [OrderStatus.RECEIVED]));

      expect(onlyReceived).toEqual([{ marketplace: 'AMAZON', orders: 1, units: 1, totalCents: 1_500_000 }]);
    });

    it('adds up amounts that do not fit in 32 bits', async () => {
      await store(
        snapshot({ marketplace: 'AMAZON', totalCents: 4_000_000_000, items: [{ sku: 'A', quantity: 4000, unitPriceCents: 1_000_000 }] }),
        snapshot({ marketplace: 'AMAZON', totalCents: 4_000_000_000, items: [{ sku: 'A', quantity: 4000, unitPriceCents: 1_000_000 }] }),
      );

      const sales = await repository.salesByMarketplace(period('2026-10-28T00:00:00Z', '2026-10-29T00:00:00Z'));

      expect(sales).toEqual([{ marketplace: 'AMAZON', orders: 2, units: 8000, totalCents: 8_000_000_000 }]);
    });
  });

  describe('the table', () => {
    const row = (overrides: Record<string, unknown> = {}) => ({
      id: crypto.randomUUID(),
      marketplace: 'AMAZON',
      external_order_id: 'EXT',
      status: 'RECEIVED',
      total_cents: 100,
      items: '[]',
      ordered_at: ORDERED_AT,
      updated_at: NOW,
      ...overrides,
    });

    it('refuses a status the model does not know', async () => {
      await expect(db('orders').insert(row({ status: 'SHIPPED' }))).rejects.toThrow(/orders_status_check/);
    });

    it('refuses a negative total', async () => {
      await expect(db('orders').insert(row({ total_cents: -1 }))).rejects.toThrow(/orders_total_check/);
    });

    it('refuses the same marketplace and external order id twice', async () => {
      await db('orders').insert(row());

      await expect(db('orders').insert(row())).rejects.toThrow(/duplicate key/);
    });
  });
});
