import { MarketplaceRegistry, UnsupportedMarketplaceError } from '../marketplace/marketplace.registry';
import { Marketplace } from '../marketplace/model/marketplace';
import { MarketplaceRejectedError, MarketplaceUnavailableError } from '../marketplace/model/marketplace.errors';
import { CanonicalOrder, MarketplacePort } from '../marketplace/port/out/marketplace.port';
import { MarketplaceOrder } from './model/marketplace-order.entity';
import { OrderReceived } from './model/order-received.event';
import { OrderFacade } from './order.facade';
import { MarketplaceOrderRepositoryPort } from './port/out/marketplace-order.repository';
import { OrderCursorRepositoryPort } from './port/out/order-cursor.repository';

const NOW = new Date('2026-10-28T13:05:00.000Z');
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

class InMemoryOrders implements MarketplaceOrderRepositoryPort {
  readonly saved: MarketplaceOrder[] = [];

  async saveIfNew(order: MarketplaceOrder): Promise<boolean> {
    if (this.saved.some(known => known.id.equals(order.id))) {
      return false;
    }
    this.saved.push(order);
    return true;
  }
}

class InMemoryCursors implements OrderCursorRepositoryPort {
  readonly cursors = new Map<Marketplace, Date>();

  async find(marketplace: Marketplace): Promise<Date | null> {
    return this.cursors.get(marketplace) ?? null;
  }

  async save(marketplace: Marketplace, startedAt: Date): Promise<void> {
    this.cursors.set(marketplace, startedAt);
  }
}

const canonical = (externalOrderId: string, overrides: Partial<CanonicalOrder> = {}): CanonicalOrder => ({
  externalOrderId,
  items: [{ sku: 'NB-001', quantity: 1, unitPrice: 4500 }],
  total: 4500,
  orderedAt: new Date('2026-10-28T13:04:00Z'),
  ...overrides,
});

describe('OrderFacade', () => {
  const amazon: jest.Mocked<MarketplacePort> = { marketplace: 'AMAZON', publishListing: jest.fn(), updateStock: jest.fn(), updatePrice: jest.fn(), fetchNewOrders: jest.fn(), cancelOrder: jest.fn() } as any;
  const shopee: jest.Mocked<MarketplacePort> = { marketplace: 'SHOPEE', publishListing: jest.fn(), updateStock: jest.fn(), updatePrice: jest.fn(), fetchNewOrders: jest.fn(), cancelOrder: jest.fn() } as any;
  let orders: InMemoryOrders;
  let cursors: InMemoryCursors;
  let facade: OrderFacade;

  beforeEach(() => {
    jest.resetAllMocks();
    amazon.fetchNewOrders.mockResolvedValue([]);
    shopee.fetchNewOrders.mockResolvedValue([]);
    orders = new InMemoryOrders();
    cursors = new InMemoryCursors();
    facade = new OrderFacade(
      new MarketplaceRegistry([amazon, shopee]),
      orders,
      cursors,
      { overlapMs: MINUTE_MS, initialLookbackMs: DAY_MS },
      () => NOW,
    );
  });

  describe('receive', () => {
    it('looks back the initial 24 hours when the marketplace has no cursor yet', async () => {
      await facade.receive({ marketplace: 'AMAZON' });

      expect(amazon.fetchNewOrders).toHaveBeenCalledWith(new Date(NOW.getTime() - DAY_MS));
    });

    it('looks from one minute before the cursor of the marketplace', async () => {
      const cursor = new Date('2026-10-28T13:00:00.000Z');
      await cursors.save('AMAZON', cursor);

      await facade.receive({ marketplace: 'AMAZON' });

      expect(amazon.fetchNewOrders).toHaveBeenCalledWith(new Date('2026-10-28T12:59:00.000Z'));
    });

    it('polls only the marketplace asked for, with the cursor of that marketplace', async () => {
      await cursors.save('AMAZON', new Date('2026-10-28T13:00:00.000Z'));

      await facade.receive({ marketplace: 'SHOPEE' });

      expect(shopee.fetchNewOrders).toHaveBeenCalledWith(new Date(NOW.getTime() - DAY_MS));
      expect(amazon.fetchNewOrders).not.toHaveBeenCalled();
    });

    it('saves each new order with its OrderReceived event and counts it', async () => {
      amazon.fetchNewOrders.mockResolvedValue([canonical('701-1'), canonical('701-2')]);

      const result = await facade.receive({ marketplace: 'AMAZON' });

      expect(result).toEqual({ fetched: 2, received: 2, discarded: [] });
      expect(orders.saved.map(order => order.id.value)).toEqual(['AMAZON:701-1', 'AMAZON:701-2']);
      expect(orders.saved[0].pullDomainEvents()[0]).toBeInstanceOf(OrderReceived);
    });

    it('does not count an order it already saw, even when the marketplace lists it again', async () => {
      amazon.fetchNewOrders.mockResolvedValue([canonical('701-1')]);
      await facade.receive({ marketplace: 'AMAZON' });

      const second = await facade.receive({ marketplace: 'AMAZON' });

      expect(second).toEqual({ fetched: 1, received: 0, discarded: [] });
      expect(orders.saved).toHaveLength(1);
    });

    it('treats the same external id on another marketplace as another order', async () => {
      amazon.fetchNewOrders.mockResolvedValue([canonical('1001')]);
      shopee.fetchNewOrders.mockResolvedValue([canonical('1001')]);

      await facade.receive({ marketplace: 'AMAZON' });
      await facade.receive({ marketplace: 'SHOPEE' });

      expect(orders.saved.map(order => order.id.value)).toEqual(['AMAZON:1001', 'SHOPEE:1001']);
    });

    it('discards an order that breaks the rules and keeps the others', async () => {
      amazon.fetchNewOrders.mockResolvedValue([
        canonical('701-1'),
        canonical('701-2', { items: [{ sku: 'NB-001', quantity: 0, unitPrice: 4500 }] }),
        canonical('701-3', { items: [] }),
        canonical('701-4', { total: -1 }),
        canonical('701-5'),
      ]);

      const result = await facade.receive({ marketplace: 'AMAZON' });

      expect(result.fetched).toBe(5);
      expect(result.received).toBe(2);
      expect(result.discarded).toEqual([
        { externalOrderId: '701-2', reason: 'The quantity of NB-001 must be an integer greater than zero.' },
        { externalOrderId: '701-3', reason: 'An order needs at least one item.' },
        { externalOrderId: '701-4', reason: 'The total of the order must not be negative.' },
      ]);
      expect(orders.saved.map(order => order.id.value)).toEqual(['AMAZON:701-1', 'AMAZON:701-5']);
    });

    it('saves the instant the poll started as the cursor of the marketplace, and only that marketplace', async () => {
      await facade.receive({ marketplace: 'AMAZON' });

      expect(cursors.cursors.get('AMAZON')).toEqual(NOW);
      expect(cursors.cursors.has('SHOPEE')).toBe(false);
    });

    it('keeps the cursor where it was when the marketplace does not answer', async () => {
      const cursor = new Date('2026-10-28T13:00:00.000Z');
      await cursors.save('AMAZON', cursor);
      amazon.fetchNewOrders.mockRejectedValue(new MarketplaceUnavailableError('HTTP 503', 'AMAZON', 3));

      await expect(facade.receive({ marketplace: 'AMAZON' })).rejects.toThrow('HTTP 503');

      expect(cursors.cursors.get('AMAZON')).toEqual(cursor);
    });

    it('keeps the cursor where it was when an order cannot be saved', async () => {
      amazon.fetchNewOrders.mockResolvedValue([canonical('701-1')]);
      jest.spyOn(orders, 'saveIfNew').mockRejectedValue(new Error('database down'));

      await expect(facade.receive({ marketplace: 'AMAZON' })).rejects.toThrow('database down');

      expect(cursors.cursors.has('AMAZON')).toBe(false);
    });

    it('refuses a marketplace without adapter', async () => {
      await expect(facade.receive({ marketplace: 'MERCADO_LIVRE' })).rejects.toThrow(UnsupportedMarketplaceError);
    });
  });

  describe('cancel', () => {
    it('cancels the order at the marketplace it came from, with the reason', async () => {
      await facade.cancel({ marketplace: 'SHOPEE', externalOrderId: 'SHP1', reason: 'OUT_OF_STOCK' });

      expect(shopee.cancelOrder).toHaveBeenCalledWith({ externalOrderId: 'SHP1', reason: 'OUT_OF_STOCK' });
      expect(amazon.cancelOrder).not.toHaveBeenCalled();
    });

    it('cancels without a reason when the event has none', async () => {
      await facade.cancel({ marketplace: 'AMAZON', externalOrderId: '701-1' });

      expect(amazon.cancelOrder).toHaveBeenCalledWith({ externalOrderId: '701-1', reason: undefined });
    });

    it('does not call the marketplace for an order the buyer cancelled there', async () => {
      await facade.cancel({ marketplace: 'AMAZON', externalOrderId: '701-1', reason: 'MARKETPLACE_CANCELLED' });

      expect(amazon.cancelOrder).not.toHaveBeenCalled();
    });

    it('lets the refusal of the marketplace through', async () => {
      amazon.cancelOrder.mockRejectedValue(new MarketplaceRejectedError('HTTP 409: Order already shipped', 'AMAZON'));

      await expect(facade.cancel({ marketplace: 'AMAZON', externalOrderId: '701-1' })).rejects.toThrow(MarketplaceRejectedError);
    });

    it('refuses a marketplace without adapter', async () => {
      await expect(facade.cancel({ marketplace: 'MERCADO_LIVRE', externalOrderId: '1' })).rejects.toThrow(UnsupportedMarketplaceError);
    });
  });
});
