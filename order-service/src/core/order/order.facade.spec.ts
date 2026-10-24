import { ConflictError, NotFoundError, ValidationError } from '../shared/domain/domain.error';
import { DomainEvent } from '../shared/domain/domain.event';
import { Id } from '../shared/domain/id';
import { Marketplace } from './model/marketplace.vo';
import { OrderStatus } from './model/order-status.vo';
import { Order } from './model/order.entity';
import { InvalidOrderError, OrderNotFoundError, OrderStateConflictError } from './model/order.errors';
import { OrderCancelled, OrderConfirmed, OrderPlaced } from './model/order.events';
import { ReceiveOrderPortInput } from './port/in/receive-order.port';
import { MarketplaceSales, OrderListFilter, OrderRepositoryPort, SalesPeriod } from './port/out/order.repository';
import { OrderFacade } from './order.facade';

const NOW = new Date('2026-10-28T13:05:02Z');
const ORDERED_AT = new Date('2026-10-28T13:05:00Z');
const UNKNOWN_ID = '6f1c2b8e-0000-4000-8000-0000000000ff';

// Hands out copies, like a database, so an order changed but never saved keeps its stored state.
const copy = (order: Order): Order =>
  Order.restore({
    id: order.id.value,
    marketplace: order.marketplace.value,
    externalOrderId: order.externalOrderId,
    status: order.status.value,
    totalCents: order.total.value,
    cancellationReason: order.cancellationReason?.value ?? null,
    items: order.items.map(item => item.value),
    orderedAt: order.orderedAt,
    updatedAt: order.updatedAt,
    version: order.version,
  });

class InMemoryOrderRepository implements OrderRepositoryPort {
  readonly orders = new Map<string, Order>();
  readonly saves: { kind: 'new' | 'update'; status: string; events: DomainEvent[] }[] = [];
  failWith: Error | null = null;
  lastFilter: OrderListFilter | null = null;
  listed: Order[] = [];

  async findById(id: Id): Promise<Order | null> {
    this.failIfAsked();
    const order = this.orders.get(id.value);
    return order ? copy(order) : null;
  }

  async findByExternalId(marketplace: Marketplace, externalOrderId: string): Promise<Order | null> {
    this.failIfAsked();
    const order = [...this.orders.values()].find(
      candidate => candidate.marketplace.equals(marketplace) && candidate.externalOrderId === externalOrderId,
    );
    return order ? copy(order) : null;
  }

  async saveNew(order: Order, eventId?: string): Promise<{ orderId: string; created: boolean }> {
    this.failIfAsked();
    const existing = [...this.orders.values()].find(candidate =>
      candidate.marketplace.equals(order.marketplace) && candidate.externalOrderId === order.externalOrderId,
    );
    if (existing) return { orderId: existing.id.value, created: false };
    void eventId;
    this.saves.push({ kind: 'new', status: order.status.value, events: order.pullDomainEvents() });
    this.orders.set(order.id.value, copy(order));
    return { orderId: order.id.value, created: true };
  }

  async save(order: Order): Promise<void> {
    this.failIfAsked();
    this.saves.push({ kind: 'update', status: order.status.value, events: order.pullDomainEvents() });
    this.orders.set(order.id.value, copy(order));
  }

  async list(filter: OrderListFilter): Promise<Order[]> {
    this.lastFilter = filter;
    return this.listed;
  }

  async salesByMarketplace(_period: SalesPeriod): Promise<MarketplaceSales[]> {
    return [];
  }

  private failIfAsked(): void {
    if (this.failWith) throw this.failWith;
  }
}

const input = (overrides: Partial<ReceiveOrderPortInput> = {}): ReceiveOrderPortInput => ({
  marketplace: 'MERCADO_LIVRE',
  externalOrderId: 'ML-2000001',
  items: [{ sku: 'IPHONE-15', quantity: 1, unitPrice: 15000 }],
  total: 15000,
  orderedAt: ORDERED_AT,
  ...overrides,
});

describe('OrderFacade', () => {
  let repository: InMemoryOrderRepository;
  let facade: OrderFacade;

  // Puts an order in the state the test needs, as if the earlier steps of its life had happened.
  const storedOrder = async (until: 'received' | 'confirmed' | 'paid' | 'noStock' | 'paymentFailed' = 'received'): Promise<string> => {
    const { orderId } = await facade.receive(input());
    if (until === 'noStock') await facade.applyStockInsufficient({ orderId });
    if (until !== 'received' && until !== 'noStock') await facade.applyStockReserved({ orderId });
    if (until === 'paid') await facade.applyPaymentConfirmed({ orderId });
    if (until === 'paymentFailed') await facade.applyPaymentFailed({ orderId });
    repository.saves.length = 0;
    return orderId;
  };

  beforeEach(() => {
    repository = new InMemoryOrderRepository();
    facade = new OrderFacade(repository, () => NOW);
  });

  describe('receive', () => {
    it('saves a RECEIVED order with a new id and publishes OrderPlaced with it', async () => {
      const result = await facade.receive(input());

      expect(result.created).toBe(true);
      expect(result.orderId).toMatch(/^[0-9a-f-]{36}$/);
      expect(repository.saves).toHaveLength(1);
      expect(repository.saves[0]).toMatchObject({ kind: 'new', status: 'RECEIVED' });
      const [event] = repository.saves[0].events;
      expect(event).toBeInstanceOf(OrderPlaced);
      expect(event).toMatchObject({
        aggregateId: result.orderId,
        marketplace: 'MERCADO_LIVRE',
        externalOrderId: 'ML-2000001',
        items: [{ sku: 'IPHONE-15', quantity: 1, unitPriceCents: 1_500_000 }],
      });
      expect(repository.orders.get(result.orderId)?.updatedAt).toEqual(NOW);
    });

    it('keeps the order it already has, saving and publishing nothing, when the marketplace order arrives again', async () => {
      const first = await facade.receive(input());
      repository.saves.length = 0;

      const again = await facade.receive(input());

      expect(again).toEqual({ orderId: first.orderId, created: false });
      expect(repository.saves).toEqual([]);
      expect(repository.orders.size).toBe(1);
    });

    it('keeps the first order even when the same marketplace order comes with other items', async () => {
      const first = await facade.receive(input());

      const again = await facade.receive(input({ items: [{ sku: 'OTHER', quantity: 2, unitPrice: 10 }], total: 20 }));

      expect(again).toEqual({ orderId: first.orderId, created: false });
      expect(repository.orders.get(first.orderId)?.items.map(item => item.sku)).toEqual(['IPHONE-15']);
    });

    it('finds the known order through the trimmed external order id', async () => {
      const first = await facade.receive(input());

      const again = await facade.receive(input({ externalOrderId: '  ML-2000001 ' }));

      expect(again).toEqual({ orderId: first.orderId, created: false });
    });

    it('takes the same external order id of another marketplace as another order', async () => {
      const first = await facade.receive(input());

      const other = await facade.receive(input({ marketplace: 'SHOPEE' }));

      expect(other.created).toBe(true);
      expect(other.orderId).not.toBe(first.orderId);
      expect(repository.orders.size).toBe(2);
    });

    it('rejects an invalid order without looking for it or saving it', async () => {
      await expect(facade.receive(input({ marketplace: 'EBAY' }))).rejects.toThrow(InvalidOrderError);
      await expect(facade.receive(input({ total: 1 }))).rejects.toThrow(InvalidOrderError);

      expect(repository.saves).toEqual([]);
    });

    it('lets a failure of the repository through, so the message is delivered again', async () => {
      repository.failWith = new Error('database is down');

      await expect(facade.receive(input())).rejects.toThrow('database is down');
    });
  });

  describe('applyStockReserved', () => {
    it('confirms a RECEIVED order and publishes OrderConfirmed with its items and total', async () => {
      const orderId = await storedOrder();

      await facade.applyStockReserved({ orderId });

      expect(repository.saves).toHaveLength(1);
      expect(repository.saves[0]).toMatchObject({ kind: 'update', status: 'CONFIRMED' });
      const [event] = repository.saves[0].events;
      expect(event).toBeInstanceOf(OrderConfirmed);
      expect(event).toMatchObject({
        aggregateId: orderId,
        marketplace: 'MERCADO_LIVRE',
        externalOrderId: 'ML-2000001',
        items: [{ sku: 'IPHONE-15', quantity: 1, unitPriceCents: 1_500_000 }],
        totalCents: 1_500_000,
        confirmedAt: NOW,
      });
    });

    it.each(['confirmed', 'paid', 'paymentFailed'] as const)('changes nothing for an order that is already %s', async state => {
      const orderId = await storedOrder(state);

      await facade.applyStockReserved({ orderId });

      expect(repository.saves).toEqual([]);
    });

    it('conflicts with an order that was cancelled for lack of stock', async () => {
      const orderId = await storedOrder('noStock');

      await expect(facade.applyStockReserved({ orderId })).rejects.toThrow(OrderStateConflictError);
      expect(repository.saves).toEqual([]);
    });
  });

  describe('applyStockInsufficient', () => {
    it('cancels a RECEIVED order for lack of stock and publishes OrderCancelled with the reason', async () => {
      const orderId = await storedOrder();

      await facade.applyStockInsufficient({ orderId });

      expect(repository.saves).toHaveLength(1);
      expect(repository.saves[0]).toMatchObject({ kind: 'update', status: 'CANCELLED' });
      const [event] = repository.saves[0].events;
      expect(event).toBeInstanceOf(OrderCancelled);
      expect(event).toMatchObject({
        aggregateId: orderId,
        reason: 'OUT_OF_STOCK',
        marketplace: 'MERCADO_LIVRE',
        externalOrderId: 'ML-2000001',
      });
      expect(repository.orders.get(orderId)?.cancellationReason?.value).toBe('OUT_OF_STOCK');
    });

    it('changes nothing for an order already cancelled for lack of stock', async () => {
      const orderId = await storedOrder('noStock');

      await facade.applyStockInsufficient({ orderId });

      expect(repository.saves).toEqual([]);
    });

    it.each(['confirmed', 'paid', 'paymentFailed'] as const)('conflicts with an order that is already %s', async state => {
      const orderId = await storedOrder(state);

      await expect(facade.applyStockInsufficient({ orderId })).rejects.toThrow(OrderStateConflictError);
      expect(repository.saves).toEqual([]);
    });
  });

  describe('applyPaymentConfirmed', () => {
    it('pays a CONFIRMED order and publishes nothing', async () => {
      const orderId = await storedOrder('confirmed');

      await facade.applyPaymentConfirmed({ orderId });

      expect(repository.saves).toEqual([{ kind: 'update', status: 'PAID', events: [] }]);
      expect(repository.orders.get(orderId)?.updatedAt).toEqual(NOW);
    });

    it('changes nothing for an order that is already paid', async () => {
      const orderId = await storedOrder('paid');

      await facade.applyPaymentConfirmed({ orderId });

      expect(repository.saves).toEqual([]);
    });

    it.each(['received', 'noStock', 'paymentFailed'] as const)('conflicts with an order that is %s', async state => {
      const orderId = await storedOrder(state);

      await expect(facade.applyPaymentConfirmed({ orderId })).rejects.toThrow(OrderStateConflictError);
      expect(repository.saves).toEqual([]);
    });
  });

  describe('applyPaymentFailed', () => {
    it('cancels a CONFIRMED order for the failed payment and publishes OrderCancelled with the reason', async () => {
      const orderId = await storedOrder('confirmed');

      await facade.applyPaymentFailed({ orderId });

      expect(repository.saves).toHaveLength(1);
      expect(repository.saves[0]).toMatchObject({ kind: 'update', status: 'CANCELLED' });
      const [event] = repository.saves[0].events;
      expect(event).toBeInstanceOf(OrderCancelled);
      expect(event).toMatchObject({ aggregateId: orderId, reason: 'PAYMENT_FAILED', marketplace: 'MERCADO_LIVRE' });
    });

    it('changes nothing for an order already cancelled for the failed payment', async () => {
      const orderId = await storedOrder('paymentFailed');

      await facade.applyPaymentFailed({ orderId });

      expect(repository.saves).toEqual([]);
    });

    it.each(['received', 'paid', 'noStock'] as const)('conflicts with an order that is %s', async state => {
      const orderId = await storedOrder(state);

      await expect(facade.applyPaymentFailed({ orderId })).rejects.toThrow(OrderStateConflictError);
      expect(repository.saves).toEqual([]);
    });
  });

  describe('an order that does not exist', () => {
    it.each([
      ['applyStockReserved', () => facade.applyStockReserved({ orderId: UNKNOWN_ID })],
      ['applyStockInsufficient', () => facade.applyStockInsufficient({ orderId: UNKNOWN_ID })],
      ['applyPaymentConfirmed', () => facade.applyPaymentConfirmed({ orderId: UNKNOWN_ID })],
      ['applyPaymentFailed', () => facade.applyPaymentFailed({ orderId: UNKNOWN_ID })],
      ['find', () => facade.find(UNKNOWN_ID)],
    ])('is not found by %s', async (_, call) => {
      await expect(call()).rejects.toThrow(OrderNotFoundError);
      await expect(call()).rejects.toThrow(NotFoundError);
      expect(repository.saves).toEqual([]);
    });

    it('is the answer for an id that is not a UUID, without asking the repository', async () => {
      repository.failWith = new Error('the database must not be asked');

      await expect(facade.find('not-a-uuid')).rejects.toThrow(OrderNotFoundError);
      await expect(facade.applyPaymentConfirmed({ orderId: '1; drop table orders' })).rejects.toThrow(OrderNotFoundError);
    });
  });

  describe('the errors of an outcome', () => {
    it('are domain errors, so a consumer sends them to the dead letter and answers stay 404 or 409', async () => {
      const received = await storedOrder();
      const paid = await storedOrder('paid');

      await expect(facade.applyPaymentFailed({ orderId: received })).rejects.toThrow(ConflictError);
      await expect(facade.applyStockInsufficient({ orderId: paid })).rejects.toThrow(ConflictError);
      await expect(facade.applyStockReserved({ orderId: UNKNOWN_ID })).rejects.toThrow(NotFoundError);
    });

    it('let a failure of the repository through, so the message is delivered again', async () => {
      const orderId = await storedOrder();
      repository.failWith = new Error('database is down');

      await expect(facade.applyStockReserved({ orderId })).rejects.toThrow('database is down');
    });
  });

  describe('find', () => {
    it('shows the order as the API does, with money in reais and the date of the sale', async () => {
      const { orderId } = await facade.receive(input({
        items: [
          { sku: 'IPHONE-15', quantity: 1, unitPrice: 4500.5 },
          { sku: 'CASE-01', quantity: 3, unitPrice: 19.99 },
        ],
        total: 4560.47,
      }));
      await facade.applyStockInsufficient({ orderId });

      const view = await facade.find(orderId);

      expect(view).toEqual({
        id: orderId,
        marketplace: 'MERCADO_LIVRE',
        externalOrderId: 'ML-2000001',
        status: 'CANCELLED',
        total: 4560.47,
        items: [
          { sku: 'IPHONE-15', quantity: 1, unitPrice: 4500.5 },
          { sku: 'CASE-01', quantity: 3, unitPrice: 19.99 },
        ],
        cancellationReason: 'OUT_OF_STOCK',
        createdAt: ORDERED_AT,
        updatedAt: NOW,
      });
    });

    it('shows no cancellation reason for an order that is not cancelled', async () => {
      const orderId = await storedOrder('paid');

      expect((await facade.find(orderId)).cancellationReason).toBeNull();
    });
  });

  describe('list', () => {
    it('asks for the first page of 20 when nothing is said, and shows the orders it gets', async () => {
      const { orderId } = await facade.receive(input());
      repository.listed = [copy(repository.orders.get(orderId)!)];

      const page = await facade.list({});

      expect(repository.lastFilter).toEqual({ marketplace: undefined, status: undefined, limit: 20, offset: 0 });
      expect(page.limit).toBe(20);
      expect(page.offset).toBe(0);
      expect(page.orders.map(order => order.id)).toEqual([orderId]);
      expect(page.orders[0]).toMatchObject({ status: 'RECEIVED', total: 15000 });
    });

    it('passes the filters and the page to the repository', async () => {
      const page = await facade.list({ marketplace: 'SHOPEE', status: 'PAID', limit: 5, offset: 10 });

      expect(repository.lastFilter?.marketplace).toBe(Marketplace.SHOPEE);
      expect(repository.lastFilter?.status).toBe(OrderStatus.PAID);
      expect(repository.lastFilter).toMatchObject({ limit: 5, offset: 10 });
      expect(page).toEqual({ orders: [], limit: 5, offset: 10 });
    });

    it.each([1, 100])('accepts a limit of %p', async limit => {
      await expect(facade.list({ limit })).resolves.toMatchObject({ limit });
    });

    it.each<[string, Parameters<OrderFacade['list']>[0]]>([
      ['a limit of zero', { limit: 0 }],
      ['a limit above 100', { limit: 101 }],
      ['a fractional limit', { limit: 2.5 }],
      ['a negative offset', { offset: -1 }],
      ['a fractional offset', { offset: 0.5 }],
      ['an offset beyond what a number holds exactly', { offset: 1e20 }],
      ['an unknown marketplace', { marketplace: 'EBAY' }],
      ['an unknown status', { status: 'SHIPPED' }],
    ])('rejects %s as a validation error', async (_, query) => {
      await expect(facade.list(query)).rejects.toThrow(ValidationError);
      expect(repository.lastFilter).toBeNull();
    });
  });
});
