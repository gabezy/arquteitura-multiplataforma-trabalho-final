import pino from 'pino';
import { MarketplaceRejectedError, MarketplaceUnavailableError } from '../../core/marketplace/model/marketplace.errors';
import { MarketplaceHttp } from './marketplace-http.client';
import { describeMercadoLivreError, MercadoLivreMarketplace } from './mercado-livre.marketplace';

const SINCE = new Date('2026-10-28T12:00:00.000Z');
const SELLER_ID = '2000';

const mlOrder = (overrides: Record<string, unknown> = {}) => ({
  id: 2000001,
  status: 'paid',
  date_created: '2026-10-28T10:05:00.000-03:00',
  total_amount: 9000,
  currency_id: 'BRL',
  order_items: [{ item: { id: 'MLB1000000001', seller_custom_field: 'NB-001' }, quantity: 2, unit_price: 4500 }],
  ...overrides,
});

const DRAFT = {
  listingId: 'a3c1d5e2-7b4f-4c8a-9e10-2d3f4a5b6c7d',
  sku: 'NB-001',
  name: 'Notebook',
  description: 'Notebook 16GB RAM',
  price: 4500.5,
  stock: 2,
};

const page = (results: unknown[], total = results.length) => ({ results, paging: { total, offset: 0, limit: 50 } });

describe('MercadoLivreMarketplace', () => {
  const lines: { level: number; msg: string; reason?: string; marketplace?: string }[] = [];
  const logger = pino({ level: 'info' }, { write: (line: string) => lines.push(JSON.parse(line)) });
  let send: jest.Mock;
  let mercadoLivre: MercadoLivreMarketplace;

  const respondWith = (...bodies: unknown[]) => {
    for (const body of bodies) {
      send.mockResolvedValueOnce({ status: 200, body });
    }
  };

  beforeEach(() => {
    lines.length = 0;
    send = jest.fn();
    mercadoLivre = new MercadoLivreMarketplace({ send } as MarketplaceHttp, { sellerId: SELLER_ID }, logger);
  });

  it('is the MERCADO_LIVRE marketplace', () => {
    expect(mercadoLivre.marketplace).toBe('MERCADO_LIVRE');
  });

  describe('fetchNewOrders', () => {
    it('searches the paid orders of the seller created since the given instant, 50 at a time', async () => {
      respondWith(page([]));

      await mercadoLivre.fetchNewOrders(SINCE);

      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith({
        method: 'GET',
        path: '/orders/search',
        query: {
          seller: SELLER_ID,
          'order.status': 'paid',
          'order.date_created.from': '2026-10-28T12:00:00.000Z',
          offset: 0,
          limit: 50,
        },
      });
    });

    it('translates the order: the id becomes text and the date is read into UTC', async () => {
      respondWith(page([mlOrder()]));

      await expect(mercadoLivre.fetchNewOrders(SINCE)).resolves.toEqual([
        {
          externalOrderId: '2000001',
          items: [{ sku: 'NB-001', quantity: 2, unitPrice: 4500 }],
          total: 9000,
          orderedAt: new Date('2026-10-28T13:05:00.000Z'),
        },
      ]);
    });

    it('keeps an id that is already text', async () => {
      respondWith(page([mlOrder({ id: '2000-A' })]));

      const [order] = await mercadoLivre.fetchNewOrders(SINCE);

      expect(order.externalOrderId).toBe('2000-A');
    });

    it('translates every item of an order', async () => {
      respondWith(page([mlOrder({
        total_amount: 4600,
        order_items: [
          { item: { seller_custom_field: 'NB-001' }, quantity: 1, unit_price: 4500 },
          { item: { seller_custom_field: 'MOUSE-1' }, quantity: 2, unit_price: 50 },
        ],
      })]));

      const [order] = await mercadoLivre.fetchNewOrders(SINCE);

      expect(order.items).toEqual([
        { sku: 'NB-001', quantity: 1, unitPrice: 4500 },
        { sku: 'MOUSE-1', quantity: 2, unitPrice: 50 },
      ]);
    });

    it('ignores an order that is not paid, without a warning', async () => {
      respondWith(page([mlOrder({ status: 'cancelled' }), mlOrder({ id: 2000002 })]));

      const orders = await mercadoLivre.fetchNewOrders(SINCE);

      expect(orders.map(order => order.externalOrderId)).toEqual(['2000002']);
      expect(lines).toEqual([]);
    });

    it.each([
      ['in another currency', { currency_id: 'ARS' }, 'Unsupported currency ARS'],
      ['with a date that is not a date', { date_created: 'ontem' }, 'date_created is not a valid date'],
      ['with a zero quantity', { order_items: [{ item: { seller_custom_field: 'NB-001' }, quantity: 0, unit_price: 10 }] }, 'quantity'],
      ['with an item without SKU', { order_items: [{ item: { id: 'MLB1' }, quantity: 1, unit_price: 10 }] }, 'seller_custom_field'],
      ['without the total', { total_amount: undefined }, 'total_amount'],
    ])('discards an order %s with a warning, and keeps the others', async (_case, overrides, reason) => {
      respondWith(page([mlOrder(overrides), mlOrder({ id: 2000002 })]));

      const orders = await mercadoLivre.fetchNewOrders(SINCE);

      expect(orders.map(order => order.externalOrderId)).toEqual(['2000002']);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ level: 40, marketplace: 'MERCADO_LIVRE' });
      expect(lines[0].reason).toContain(reason);
    });

    it('reads the next page by offset until the total is reached', async () => {
      respondWith(
        page([mlOrder({ id: 1 }), mlOrder({ id: 2 })], 5),
        page([mlOrder({ id: 3 }), mlOrder({ id: 4 })], 5),
        page([mlOrder({ id: 5 })], 5),
      );

      const orders = await mercadoLivre.fetchNewOrders(SINCE);

      expect(orders.map(order => order.externalOrderId)).toEqual(['1', '2', '3', '4', '5']);
      expect(send.mock.calls.map(([request]) => request.query.offset)).toEqual([0, 2, 4]);
    });

    it('stops when a page comes back empty, whatever the total says', async () => {
      respondWith(page([mlOrder({ id: 1 })], 10), page([], 10));

      const orders = await mercadoLivre.fetchNewOrders(SINCE);

      expect(orders).toHaveLength(1);
      expect(send).toHaveBeenCalledTimes(2);
    });

    it('stops at 10 pages and warns when the search never ends', async () => {
      send.mockImplementation(async () => ({ status: 200, body: page([mlOrder()], 1000) }));

      await mercadoLivre.fetchNewOrders(SINCE);

      expect(send).toHaveBeenCalledTimes(10);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ level: 40, msg: 'Order search cut at the maximum of pages' });
    });

    it('refuses an answer that is not an order search', async () => {
      respondWith({ something: 'else' });

      const failure = await mercadoLivre.fetchNewOrders(SINCE).catch((err: MarketplaceRejectedError) => err);

      expect(failure).toBeInstanceOf(MarketplaceRejectedError);
      expect((failure as Error).message).toContain('Unexpected order search');
    });
  });

  describe('publishListing', () => {
    const created = { status: 201, body: { id: 'MLB8685273650', status: 'active' } };

    it('posts the item, with the SKU as the seller custom field and the id of the listing as the idempotency key', async () => {
      send.mockResolvedValue(created);

      await mercadoLivre.publishListing(DRAFT);

      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith({
        method: 'POST',
        path: '/items',
        headers: { 'idempotency-key': 'a3c1d5e2-7b4f-4c8a-9e10-2d3f4a5b6c7d' },
        body: {
          title: 'Notebook',
          category_id: 'MLB1648',
          price: 4500.5,
          currency_id: 'BRL',
          available_quantity: 2,
          buying_mode: 'buy_it_now',
          listing_type_id: 'gold_special',
          condition: 'new',
          description: { plain_text: 'Notebook 16GB RAM' },
          seller_custom_field: 'NB-001',
        },
      });
    });

    it('gives the id of the item as the id of the listing', async () => {
      send.mockResolvedValue(created);

      await expect(mercadoLivre.publishListing(DRAFT)).resolves.toEqual({ externalListingId: 'MLB8685273650' });
    });

    it('cuts the title at the 60 characters the marketplace accepts', async () => {
      send.mockResolvedValue(created);

      await mercadoLivre.publishListing({ ...DRAFT, name: 'N'.repeat(100) });

      expect(send.mock.calls[0][0].body.title).toBe('N'.repeat(60));
    });

    it.each([
      ['an answer without the id', { status: 'active' }],
      ['an id that is not text', { id: 42 }],
      ['an empty answer', undefined],
    ])('refuses %s', async (_case, body) => {
      send.mockResolvedValue({ status: 201, body });

      const failure = await mercadoLivre.publishListing(DRAFT).catch((err: MarketplaceRejectedError) => err);

      expect(failure).toBeInstanceOf(MarketplaceRejectedError);
      expect((failure as Error).message).toContain('The listing was not created');
    });

    it('lets the failure of the call through', async () => {
      const refusal = new MarketplaceRejectedError('HTTP 400: Validation error: Item price invalid', 'MERCADO_LIVRE');
      send.mockRejectedValue(refusal);

      await expect(mercadoLivre.publishListing(DRAFT)).rejects.toBe(refusal);
    });
  });

  describe('updateStock', () => {
    const UPDATE = { externalListingId: 'MLB8685273650', sku: 'NB-001', stock: 1 };
    const updated = { status: 200, body: { id: 'MLB8685273650', status: 'active', last_updated: '2026-10-28T13:05:02.000Z' } };

    it('puts the available quantity on the item', async () => {
      send.mockResolvedValue(updated);

      await mercadoLivre.updateStock(UPDATE);

      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith({ method: 'PUT', path: '/items/MLB8685273650', body: { available_quantity: 1 } });
    });

    it('sends a stock of zero as it is, to make the item unavailable', async () => {
      send.mockResolvedValue(updated);

      await mercadoLivre.updateStock({ ...UPDATE, stock: 0 });

      expect(send.mock.calls[0][0].body).toEqual({ available_quantity: 0 });
    });

    it('escapes the id in the path', async () => {
      send.mockResolvedValue(updated);

      await mercadoLivre.updateStock({ ...UPDATE, externalListingId: 'MLB 1/2' });

      expect(send.mock.calls[0][0].path).toBe('/items/MLB%201%2F2');
    });

    it('lets the failure of the call through', async () => {
      const outage = new MarketplaceUnavailableError('HTTP 503', 'MERCADO_LIVRE');
      send.mockRejectedValue(outage);

      await expect(mercadoLivre.updateStock(UPDATE)).rejects.toBe(outage);
    });
  });

  describe('cancelOrder', () => {
    it('puts the cancelled status on the order, with the reason', async () => {
      send.mockResolvedValue({ status: 200, body: {} });

      await mercadoLivre.cancelOrder({ externalOrderId: '2000001', reason: 'PAYMENT_FAILED' });

      expect(send).toHaveBeenCalledWith({
        method: 'PUT',
        path: '/orders/2000001',
        body: { status: 'cancelled', reason: 'PAYMENT_FAILED' },
      });
    });

    it('sends OTHER when there is no reason', async () => {
      send.mockResolvedValue({ status: 200, body: {} });

      await mercadoLivre.cancelOrder({ externalOrderId: '2000001' });

      expect(send).toHaveBeenCalledWith({ method: 'PUT', path: '/orders/2000001', body: { status: 'cancelled', reason: 'OTHER' } });
    });

    it('lets the failure of the call through', async () => {
      const refusal = new MarketplaceRejectedError('HTTP 409: Order cannot be cancelled', 'MERCADO_LIVRE');
      send.mockRejectedValue(refusal);

      await expect(mercadoLivre.cancelOrder({ externalOrderId: '2000-SHIPPED' })).rejects.toBe(refusal);
    });
  });
});

describe('describeMercadoLivreError', () => {
  it('names the message and its first cause', () => {
    expect(describeMercadoLivreError({ message: 'Validation error', cause: [{ code: 'item.price.invalid', message: 'Item price invalid' }] }))
      .toBe('Validation error: Item price invalid');
  });

  it('names the message alone when there is no cause', () => {
    expect(describeMercadoLivreError({ message: 'Order not found', cause: [] })).toBe('Order not found');
  });

  it.each([undefined, null, 'text', {}])('has nothing to say about %p', body => {
    expect(describeMercadoLivreError(body)).toBeUndefined();
  });
});
