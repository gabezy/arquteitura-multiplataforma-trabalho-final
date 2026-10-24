import pino from 'pino';
import { MarketplaceRejectedError } from '../../core/marketplace/model/marketplace.errors';
import { AmazonMarketplace, describeAmazonError } from './amazon.marketplace';
import { MarketplaceHttp } from './marketplace-http.client';

const SINCE = new Date('2026-10-28T12:00:00.000Z');
const MARKETPLACE_ID = 'A2Q3Y263D00KWC';

const amazonOrder = (overrides: Record<string, unknown> = {}) => ({
  AmazonOrderId: '701-1111111-2222222',
  PurchaseDate: '2026-10-28T13:05:00Z',
  OrderStatus: 'Unshipped',
  OrderTotal: { CurrencyCode: 'BRL', Amount: '9000.00' },
  OrderItems: [{ SellerSKU: 'NB-001', QuantityOrdered: 2, ItemPrice: { CurrencyCode: 'BRL', Amount: '9000.00' } }],
  ...overrides,
});

const page = (orders: unknown[], nextToken: string | null = null) => ({ payload: { Orders: orders, NextToken: nextToken } });

describe('AmazonMarketplace', () => {
  const lines: { level: number; msg: string; reason?: string; marketplace?: string }[] = [];
  const logger = pino({ level: 'info' }, { write: (line: string) => lines.push(JSON.parse(line)) });
  let send: jest.Mock;
  let amazon: AmazonMarketplace;

  const respondWith = (...bodies: unknown[]) => {
    for (const body of bodies) {
      send.mockResolvedValueOnce({ status: 200, body });
    }
  };

  beforeEach(() => {
    lines.length = 0;
    send = jest.fn();
    amazon = new AmazonMarketplace({ send } as MarketplaceHttp, { marketplaceId: MARKETPLACE_ID }, logger);
  });

  it('is the AMAZON marketplace', () => {
    expect(amazon.marketplace).toBe('AMAZON');
  });

  describe('fetchNewOrders', () => {
    it('asks for the orders not shipped yet, created since the given instant', async () => {
      respondWith(page([]));

      await amazon.fetchNewOrders(SINCE);

      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith({
        method: 'GET',
        path: '/orders/v0/orders',
        query: { MarketplaceIds: MARKETPLACE_ID, CreatedAfter: '2026-10-28T12:00:00.000Z', OrderStatuses: 'Unshipped' },
      });
    });

    it('translates the order: the unit price is the price of the line divided by the quantity', async () => {
      respondWith(page([amazonOrder()]));

      await expect(amazon.fetchNewOrders(SINCE)).resolves.toEqual([
        {
          externalOrderId: '701-1111111-2222222',
          items: [{ sku: 'NB-001', quantity: 2, unitPrice: 4500 }],
          total: 9000,
          orderedAt: new Date('2026-10-28T13:05:00Z'),
        },
      ]);
    });

    it('rounds the unit price to the cent', async () => {
      respondWith(page([amazonOrder({
        OrderTotal: { CurrencyCode: 'BRL', Amount: '100.00' },
        OrderItems: [{ SellerSKU: 'CABO-1', QuantityOrdered: 3, ItemPrice: { CurrencyCode: 'BRL', Amount: '100.00' } }],
      })]));

      const [order] = await amazon.fetchNewOrders(SINCE);

      expect(order.items).toEqual([{ sku: 'CABO-1', quantity: 3, unitPrice: 33.33 }]);
      expect(order.total).toBe(100);
    });

    it('translates every item of an order', async () => {
      respondWith(page([amazonOrder({
        OrderTotal: { CurrencyCode: 'BRL', Amount: '4600.00' },
        OrderItems: [
          { SellerSKU: 'NB-001', QuantityOrdered: 1, ItemPrice: { CurrencyCode: 'BRL', Amount: '4500.00' } },
          { SellerSKU: 'MOUSE-1', QuantityOrdered: 2, ItemPrice: { CurrencyCode: 'BRL', Amount: '100.00' } },
        ],
      })]));

      const [order] = await amazon.fetchNewOrders(SINCE);

      expect(order.items).toEqual([
        { sku: 'NB-001', quantity: 1, unitPrice: 4500 },
        { sku: 'MOUSE-1', quantity: 2, unitPrice: 50 },
      ]);
    });

    it('ignores an order that is not in the status asked for, without a warning', async () => {
      respondWith(page([amazonOrder({ OrderStatus: 'Canceled' }), amazonOrder({ AmazonOrderId: '701-3333333-4444444' })]));

      const orders = await amazon.fetchNewOrders(SINCE);

      expect(orders.map(order => order.externalOrderId)).toEqual(['701-3333333-4444444']);
      expect(lines).toEqual([]);
    });

    it.each([
      ['in another currency', { OrderTotal: { CurrencyCode: 'USD', Amount: '9000.00' } }, 'Unsupported currency USD'],
      ['with an item in another currency', { OrderItems: [{ SellerSKU: 'NB-001', QuantityOrdered: 2, ItemPrice: { CurrencyCode: 'USD', Amount: '9000.00' } }] }, 'Unsupported currency USD'],
      ['with an amount that is not a number', { OrderTotal: { CurrencyCode: 'BRL', Amount: 'abc' } }, 'OrderTotal.Amount is not a number'],
      ['with a date that is not a date', { PurchaseDate: 'ontem' }, 'PurchaseDate is not a valid date'],
      ['with a zero quantity', { OrderItems: [{ SellerSKU: 'NB-001', QuantityOrdered: 0, ItemPrice: { CurrencyCode: 'BRL', Amount: '0.00' } }] }, 'QuantityOrdered'],
      ['without the id', { AmazonOrderId: undefined }, 'AmazonOrderId'],
      ['without items', { OrderItems: undefined }, 'OrderItems'],
    ])('discards an order %s with a warning, and keeps the others', async (_case, overrides, reason) => {
      respondWith(page([amazonOrder(overrides), amazonOrder({ AmazonOrderId: '701-3333333-4444444' })]));

      const orders = await amazon.fetchNewOrders(SINCE);

      expect(orders.map(order => order.externalOrderId)).toEqual(['701-3333333-4444444']);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ level: 40, marketplace: 'AMAZON' });
      expect(lines[0].reason).toContain(reason);
    });

    it('discards something that is not even an object', async () => {
      respondWith(page(['lixo', null, amazonOrder()]));

      const orders = await amazon.fetchNewOrders(SINCE);

      expect(orders).toHaveLength(1);
      expect(lines).toHaveLength(2);
    });

    it('reads the next page by its token alone, until there is none', async () => {
      respondWith(
        page([amazonOrder({ AmazonOrderId: '701-1' })], 'token-2'),
        page([amazonOrder({ AmazonOrderId: '701-2' })], 'token-3'),
        page([amazonOrder({ AmazonOrderId: '701-3' })]),
      );

      const orders = await amazon.fetchNewOrders(SINCE);

      expect(orders.map(order => order.externalOrderId)).toEqual(['701-1', '701-2', '701-3']);
      expect(send.mock.calls.map(([request]) => request.query)).toEqual([
        { MarketplaceIds: MARKETPLACE_ID, CreatedAfter: '2026-10-28T12:00:00.000Z', OrderStatuses: 'Unshipped' },
        { MarketplaceIds: MARKETPLACE_ID, NextToken: 'token-2' },
        { MarketplaceIds: MARKETPLACE_ID, NextToken: 'token-3' },
      ]);
    });

    it('stops at 10 pages and warns when the listing never ends', async () => {
      send.mockImplementation(async () => ({ status: 200, body: page([], 'again') }));

      await amazon.fetchNewOrders(SINCE);

      expect(send).toHaveBeenCalledTimes(10);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ level: 40, msg: 'Order listing cut at the maximum of pages' });
    });

    it('refuses an answer that is not an order listing', async () => {
      respondWith({ something: 'else' });

      const failure = await amazon.fetchNewOrders(SINCE).catch((err: MarketplaceRejectedError) => err);

      expect(failure).toBeInstanceOf(MarketplaceRejectedError);
      expect(failure).toMatchObject({ marketplace: 'AMAZON' });
      expect((failure as Error).message).toContain('Unexpected order listing');
    });
  });

  describe('cancelOrder', () => {
    it('posts the cancellation of the order, with the reason', async () => {
      send.mockResolvedValue({ status: 200, body: {} });

      await amazon.cancelOrder({ externalOrderId: '701-1111111-2222222', reason: 'OUT_OF_STOCK' });

      expect(send).toHaveBeenCalledWith({
        method: 'POST',
        path: '/orders/v0/orders/701-1111111-2222222/cancellation',
        body: { cancelReason: 'OUT_OF_STOCK' },
      });
    });

    it('sends OTHER when there is no reason, and escapes the id in the path', async () => {
      send.mockResolvedValue({ status: 200, body: {} });

      await amazon.cancelOrder({ externalOrderId: 'a/b c' });

      expect(send).toHaveBeenCalledWith({ method: 'POST', path: '/orders/v0/orders/a%2Fb%20c/cancellation', body: { cancelReason: 'OTHER' } });
    });

    it('lets the failure of the call through', async () => {
      const refusal = new MarketplaceRejectedError('HTTP 409: InvalidInput: Order already shipped', 'AMAZON');
      send.mockRejectedValue(refusal);

      await expect(amazon.cancelOrder({ externalOrderId: '701-SHIPPED-1' })).rejects.toBe(refusal);
    });
  });
});

describe('describeAmazonError', () => {
  it('names the first error of the answer', () => {
    expect(describeAmazonError({ errors: [{ code: 'InvalidInput', message: 'list_price must be greater than zero' }] }))
      .toBe('InvalidInput: list_price must be greater than zero');
  });

  it.each([undefined, null, 'text', {}, { errors: [] }])('has nothing to say about %p', body => {
    expect(describeAmazonError(body)).toBeUndefined();
  });
});
