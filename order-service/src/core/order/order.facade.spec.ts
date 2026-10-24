import { Order } from './model/order.entity';
import { OrderNotFoundError } from './model/order.errors';
import { OrderFilter, PageRequest } from './port/in/list-orders.port';
import { ReceiveOrderPortInput } from './port/in/receive-order.port';
import { OrderRepositoryPort } from './port/out/order.repository';
import { OrderFacade } from './order.facade';

class InMemoryOrderRepository implements OrderRepositoryPort {
  readonly orders: Order[] = [];
  readonly eventIds: (string | undefined)[] = [];
  lastList?: { filter: OrderFilter; page: PageRequest };

  async saveReceived(order: Order, eventId?: string): Promise<boolean> {
    this.eventIds.push(eventId);
    const exists = this.orders.some(o => o.marketplace === order.marketplace && o.externalOrderId === order.externalOrderId);
    if (!exists) {
      this.orders.push(order);
    }
    return !exists;
  }

  async findById(id: string): Promise<Order | null> {
    return this.orders.find(order => order.id.value === id) ?? null;
  }

  async list(filter: OrderFilter, page: PageRequest): Promise<Order[]> {
    this.lastList = { filter, page };
    return this.orders;
  }
}

const ORDERED_AT = new Date('2026-10-28T13:05:00Z');

const input = (overrides: Partial<ReceiveOrderPortInput> = {}): ReceiveOrderPortInput => ({
  eventId: 'e1',
  marketplace: 'MERCADO_LIVRE',
  externalOrderId: 'ML-2000001',
  items: [{ sku: 'NB-001', quantity: 2, unitPrice: 4500.5 }],
  orderedAt: ORDERED_AT,
  ...overrides,
});

describe('OrderFacade', () => {
  let repository: InMemoryOrderRepository;
  let facade: OrderFacade;

  beforeEach(() => {
    repository = new InMemoryOrderRepository();
    facade = new OrderFacade(repository);
  });

  describe('receive', () => {
    it('saves a new marketplace order and returns it as created', async () => {
      const { outcome, order } = await facade.receive(input());

      expect(outcome).toBe('created');
      expect(repository.orders).toHaveLength(1);
      expect(order).toEqual({
        id: repository.orders[0].id.value,
        marketplace: 'MERCADO_LIVRE',
        externalOrderId: 'ML-2000001',
        status: 'RECEIVED',
        total: 9001,
        items: [{ sku: 'NB-001', quantity: 2, unitPrice: 4500.5 }],
        cancellationReason: null,
        orderedAt: ORDERED_AT,
        createdAt: repository.orders[0].createdAt,
        updatedAt: repository.orders[0].updatedAt,
      });
    });

    it('returns duplicate and keeps the stored order when the marketplace order exists', async () => {
      const first = await facade.receive(input());

      const second = await facade.receive(input({ eventId: 'e2', items: [{ sku: 'OTHER', quantity: 1, unitPrice: 1 }] }));

      expect(second.outcome).toBe('duplicate');
      expect(repository.orders).toHaveLength(1);
      expect(repository.orders[0].id.value).toBe(first.order.id);
      expect(repository.orders[0].items[0].sku).toBe('NB-001');
    });

    it('passes the event id to the repository untouched, also when absent', async () => {
      await facade.receive(input({ eventId: 'ce-123' }));
      await facade.receive(input({ eventId: undefined, externalOrderId: 'ML-2' }));

      expect(repository.eventIds).toEqual(['ce-123', undefined]);
    });
  });

  describe('get', () => {
    it('returns the order with the id', async () => {
      const { order } = await facade.receive(input());

      await expect(facade.get(order.id)).resolves.toEqual(order);
    });

    it('rejects an unknown id with OrderNotFoundError', async () => {
      await expect(facade.get('6f1c2b8e-0000-4000-8000-000000000009')).rejects.toThrow(OrderNotFoundError);
    });
  });

  describe('list', () => {
    it('passes the filter and the page to the repository untouched and returns the orders', async () => {
      const { order } = await facade.receive(input());

      const orders = await facade.list({ marketplace: 'SHOPEE', status: 'PAID' }, { limit: 5, offset: 10 });

      expect(repository.lastList).toEqual({ filter: { marketplace: 'SHOPEE', status: 'PAID' }, page: { limit: 5, offset: 10 } });
      expect(orders).toEqual([order]);
    });
  });
});
