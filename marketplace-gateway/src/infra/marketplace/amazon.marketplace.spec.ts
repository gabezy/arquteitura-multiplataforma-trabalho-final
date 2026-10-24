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

const DRAFT = {
  listingId: 'a3c1d5e2-7b4f-4c8a-9e10-2d3f4a5b6c7d',
  sku: 'NB-001',
  name: 'Notebook',
  description: 'Notebook 16GB RAM',
  price: 4500,
  stock: 2,
};

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
    amazon = new AmazonMarketplace({ send } as MarketplaceHttp, { sellerId: 'A1B2C3D4E5', marketplaceId: MARKETPLACE_ID }, logger);
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

  describe('publishListing', () => {
    const accepted = { status: 200, body: { sku: 'NB-001', status: 'ACCEPTED', submissionId: 's1', asin: 'B07T7C4QAF', issues: [] } };

    it('puts the listing by SKU, with the id of the listing as the idempotency key', async () => {
      send.mockResolvedValue(accepted);

      await amazon.publishListing(DRAFT);

      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith({
        method: 'PUT',
        path: '/listings/2021-08-01/items/A1B2C3D4E5/NB-001',
        query: { marketplaceIds: MARKETPLACE_ID },
        headers: { 'idempotency-key': 'a3c1d5e2-7b4f-4c8a-9e10-2d3f4a5b6c7d' },
        body: {
          productType: 'PRODUCT',
          attributes: {
            item_name: [{ value: 'Notebook' }],
            product_description: [{ value: 'Notebook 16GB RAM' }],
            list_price: [{ currency: 'BRL', value: 4500 }],
            fulfillment_availability: [{ fulfillment_channel_code: 'DEFAULT', quantity: 2 }],
          },
        },
      });
    });

    it('gives the ASIN as the id of the listing', async () => {
      send.mockResolvedValue(accepted);

      await expect(amazon.publishListing(DRAFT)).resolves.toEqual({ externalListingId: 'B07T7C4QAF' });
    });

    it('escapes the SKU in the path', async () => {
      send.mockResolvedValue(accepted);

      await amazon.publishListing({ ...DRAFT, sku: 'A/B C' });

      expect(send.mock.calls[0][0].path).toBe('/listings/2021-08-01/items/A1B2C3D4E5/A%2FB%20C');
    });

    it.each([
      ['a listing that was not accepted', { sku: 'NB-001', status: 'INVALID', asin: 'B0X', issues: [] }],
      ['an answer without the ASIN', { sku: 'NB-001', status: 'ACCEPTED' }],
      ['an answer that is not an object', 'lixo'],
      ['an empty answer', null],
    ])('refuses %s', async (_case, body) => {
      send.mockResolvedValue({ status: 200, body });

      const failure = await amazon.publishListing(DRAFT).catch((err: MarketplaceRejectedError) => err);

      expect(failure).toBeInstanceOf(MarketplaceRejectedError);
      expect((failure as Error).message).toContain('The listing was not accepted');
    });

    it('lets the failure of the call through', async () => {
      const refusal = new MarketplaceRejectedError('HTTP 400: InvalidInput: list_price must be greater than zero', 'AMAZON');
      send.mockRejectedValue(refusal);

      await expect(amazon.publishListing(DRAFT)).rejects.toBe(refusal);
    });
  });

  describe('updateStock', () => {
    const UPDATE = { externalListingId: 'B07T7C4QAF', sku: 'NB-001', stock: 1 };
    const accepted = { status: 200, body: { sku: 'NB-001', status: 'ACCEPTED', submissionId: 's1', issues: [] } };

    it('patches the availability of the listing by SKU, with the stock as the quantity', async () => {
      send.mockResolvedValue(accepted);

      await amazon.updateStock(UPDATE);

      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith({
        method: 'PATCH',
        path: '/listings/2021-08-01/items/A1B2C3D4E5/NB-001',
        query: { marketplaceIds: MARKETPLACE_ID },
        body: {
          productType: 'PRODUCT',
          patches: [{
            op: 'replace',
            path: '/attributes/fulfillment_availability',
            value: [{ fulfillment_channel_code: 'DEFAULT', quantity: 1 }],
          }],
        },
      });
    });

    it('sends a stock of zero as it is, to make the listing unavailable', async () => {
      send.mockResolvedValue(accepted);

      await amazon.updateStock({ ...UPDATE, stock: 0 });

      expect(send.mock.calls[0][0].body.patches[0].value).toEqual([{ fulfillment_channel_code: 'DEFAULT', quantity: 0 }]);
    });

    it('escapes the SKU in the path', async () => {
      send.mockResolvedValue(accepted);

      await amazon.updateStock({ ...UPDATE, sku: 'A/B C' });

      expect(send.mock.calls[0][0].path).toBe('/listings/2021-08-01/items/A1B2C3D4E5/A%2FB%20C');
    });

    it.each([
      ['a change that was not accepted', { sku: 'NB-001', status: 'INVALID', issues: [] }],
      ['an answer without the status', { sku: 'NB-001' }],
      ['an answer that is not an object', 'lixo'],
      ['an empty answer', null],
    ])('refuses %s', async (_case, body) => {
      send.mockResolvedValue({ status: 200, body });

      const failure = await amazon.updateStock(UPDATE).catch((err: MarketplaceRejectedError) => err);

      expect(failure).toBeInstanceOf(MarketplaceRejectedError);
      expect((failure as Error).message).toContain('The stock was not accepted');
    });

    it('lets the failure of the call through', async () => {
      const refusal = new MarketplaceRejectedError('HTTP 404: NotFound: listing not found', 'AMAZON');
      send.mockRejectedValue(refusal);

      await expect(amazon.updateStock(UPDATE)).rejects.toBe(refusal);
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
