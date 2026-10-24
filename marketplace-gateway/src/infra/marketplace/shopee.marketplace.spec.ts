import pino from 'pino';
import {
    MarketplaceRejectedError,
    MarketplaceUnavailableError,
} from '../../core/marketplace/model/marketplace.errors';
import { MarketplaceHttp } from './marketplace-http.client';
import { describeShopeeError, ShopeeMarketplace } from './shopee.marketplace';

const NOW = new Date('2026-10-28T14:00:00.000Z');
const SINCE = new Date('2026-10-28T12:00:00.000Z');
const SHOP_ID = '1001';
const CREATED_AT = Date.parse('2026-10-28T13:05:00Z') / 1000;

const shopeeOrder = (overrides: Record<string, unknown> = {}) => ({
  order_sn: 'SHP261028A1B2C3',
  order_status: 'READY_TO_SHIP',
  create_time: CREATED_AT,
  total_amount: 9000,
  item_list: [{ item_sku: 'NB-001', model_quantity_purchased: 2, model_discounted_price: 4500 }],
  ...overrides,
});

const answer = (orders: unknown[], more = false, nextCursor = '') => ({
  error: '',
  message: '',
  request_id: 'r1',
  response: { more, next_cursor: nextCursor, order_list: orders },
});

describe('ShopeeMarketplace', () => {
  const lines: { level: number; msg: string; reason?: string; marketplace?: string }[] = [];
  const logger = pino({ level: 'info' }, { write: (line: string) => lines.push(JSON.parse(line)) });
  let send: jest.Mock;
  let shopee: ShopeeMarketplace;

  const respondWith = (...bodies: unknown[]) => {
    for (const body of bodies) {
      send.mockResolvedValueOnce({ status: 200, body });
    }
  };

  beforeEach(() => {
    lines.length = 0;
    send = jest.fn();
    shopee = new ShopeeMarketplace({ send } as MarketplaceHttp, { shopId: SHOP_ID }, logger, () => NOW);
  });

  it('is the SHOPEE marketplace', () => {
    expect(shopee.marketplace).toBe('SHOPEE');
  });

  describe('fetchNewOrders', () => {
    it('lists the orders ready to ship, created in the window from the given instant to now, in epoch seconds', async () => {
      respondWith(answer([]));

      await shopee.fetchNewOrders(SINCE);

      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith({
        method: 'GET',
        path: '/api/v2/order/get_order_list',
        query: {
          shop_id: SHOP_ID,
          time_range_field: 'create_time',
          time_from: Date.parse('2026-10-28T12:00:00Z') / 1000,
          time_to: Date.parse('2026-10-28T14:00:00Z') / 1000,
          page_size: 100,
          order_status: 'READY_TO_SHIP',
          cursor: undefined,
        },
      });
    });

    it('does not ask for a window longer than the 15 days Shopee accepts', async () => {
      respondWith(answer([]));

      await shopee.fetchNewOrders(new Date('2026-01-01T00:00:00Z'));

      const { time_from, time_to } = send.mock.calls[0][0].query;
      expect(time_to - time_from).toBe(15 * 24 * 60 * 60);
    });

    it('translates the order: the date is read from epoch seconds and the unit price comes as it is', async () => {
      respondWith(answer([shopeeOrder()]));

      await expect(shopee.fetchNewOrders(SINCE)).resolves.toEqual([
        {
          externalOrderId: 'SHP261028A1B2C3',
          items: [{ sku: 'NB-001', quantity: 2, unitPrice: 4500 }],
          total: 9000,
          orderedAt: new Date('2026-10-28T13:05:00.000Z'),
        },
      ]);
    });

    it('translates every item of an order', async () => {
      respondWith(answer([shopeeOrder({
        total_amount: 4600,
        item_list: [
          { item_sku: 'NB-001', model_quantity_purchased: 1, model_discounted_price: 4500 },
          { item_sku: 'MOUSE-1', model_quantity_purchased: 2, model_discounted_price: 50 },
        ],
      })]));

      const [order] = await shopee.fetchNewOrders(SINCE);

      expect(order.items).toEqual([
        { sku: 'NB-001', quantity: 1, unitPrice: 4500 },
        { sku: 'MOUSE-1', quantity: 2, unitPrice: 50 },
      ]);
    });

    it('ignores an order that is not ready to ship, without a warning', async () => {
      respondWith(answer([shopeeOrder({ order_status: 'CANCELLED' }), shopeeOrder({ order_sn: 'SHP2' })]));

      const orders = await shopee.fetchNewOrders(SINCE);

      expect(orders.map(order => order.externalOrderId)).toEqual(['SHP2']);
      expect(lines).toEqual([]);
    });

    it.each([
      ['with a zero quantity', { item_list: [{ item_sku: 'NB-001', model_quantity_purchased: 0, model_discounted_price: 10 }] }, 'model_quantity_purchased'],
      ['with an item without SKU', { item_list: [{ model_quantity_purchased: 1, model_discounted_price: 10 }] }, 'item_sku'],
      ['with a total that is not a number', { total_amount: 'muito' }, 'total_amount'],
      ['with a date that is text', { create_time: 'ontem' }, 'create_time'],
      ['without the id', { order_sn: undefined }, 'order_sn'],
    ])('discards an order %s with a warning, and keeps the others', async (_case, overrides, reason) => {
      respondWith(answer([shopeeOrder(overrides), shopeeOrder({ order_sn: 'SHP2' })]));

      const orders = await shopee.fetchNewOrders(SINCE);

      expect(orders.map(order => order.externalOrderId)).toEqual(['SHP2']);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ level: 40, marketplace: 'SHOPEE' });
      expect(lines[0].reason).toContain(reason);
    });

    it('reads the next page by cursor while there are more', async () => {
      respondWith(
        answer([shopeeOrder({ order_sn: 'SHP1' })], true, 'cursor-2'),
        answer([shopeeOrder({ order_sn: 'SHP2' })], true, 'cursor-3'),
        answer([shopeeOrder({ order_sn: 'SHP3' })]),
      );

      const orders = await shopee.fetchNewOrders(SINCE);

      expect(orders.map(order => order.externalOrderId)).toEqual(['SHP1', 'SHP2', 'SHP3']);
      expect(send.mock.calls.map(([request]) => request.query.cursor)).toEqual([undefined, 'cursor-2', 'cursor-3']);
    });

    it('stops when it says there are more but gives no cursor', async () => {
      respondWith(answer([shopeeOrder()], true, ''));

      await shopee.fetchNewOrders(SINCE);

      expect(send).toHaveBeenCalledTimes(1);
    });

    it('stops at 10 pages and warns when the list never ends', async () => {
      send.mockImplementation(async () => ({ status: 200, body: answer([], true, 'again') }));

      await shopee.fetchNewOrders(SINCE);

      expect(send).toHaveBeenCalledTimes(10);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ level: 40, msg: 'Order list cut at the maximum of pages' });
    });

    it('refuses an answer that is not an order list', async () => {
      respondWith({ error: '', message: '', response: { something: 'else' } });

      const failure = await shopee.fetchNewOrders(SINCE).catch((err: MarketplaceRejectedError) => err);

      expect(failure).toBeInstanceOf(MarketplaceRejectedError);
      expect((failure as Error).message).toContain('Unexpected order list');
    });

    it('refuses an answer without the envelope', async () => {
      respondWith({ orders: [] });

      await expect(shopee.fetchNewOrders(SINCE)).rejects.toThrow(MarketplaceRejectedError);
    });

    it('treats an error inside a 200 as a refusal, with its code and message', async () => {
      respondWith({ error: 'error_param', message: 'time_from is out of range', request_id: 'r1' });

      const failure = await shopee.fetchNewOrders(SINCE).catch((err: MarketplaceRejectedError) => err);

      expect(failure).toBeInstanceOf(MarketplaceRejectedError);
      expect(failure).toMatchObject({ message: 'error_param: time_from is out of range', marketplace: 'SHOPEE' });
    });

    it.each(['error_server', 'error_busy', 'error_rate_limit', 'error_timeout'])('treats %s inside a 200 as the marketplace being unavailable', async error => {
      respondWith({ error, message: 'try later', request_id: 'r1' });

      const failure = await shopee.fetchNewOrders(SINCE).catch((err: MarketplaceUnavailableError) => err);

      expect(failure).toBeInstanceOf(MarketplaceUnavailableError);
    });
  });

  describe('cancelOrder', () => {
    it('posts the cancellation of the order to the shop, with the reason', async () => {
      send.mockResolvedValue({ status: 200, body: { error: '', message: '', response: { update_time: 1 } } });

      await shopee.cancelOrder({ externalOrderId: 'SHP261028A1B2C3', reason: 'OUT_OF_STOCK' });

      expect(send).toHaveBeenCalledWith({
        method: 'POST',
        path: '/api/v2/order/cancel_order',
        query: { shop_id: SHOP_ID },
        body: { order_sn: 'SHP261028A1B2C3', cancel_reason: 'OUT_OF_STOCK' },
      });
    });

    it('sends OTHER when there is no reason', async () => {
      send.mockResolvedValue({ status: 200, body: { error: '', message: '' } });

      await shopee.cancelOrder({ externalOrderId: 'SHP1' });

      expect(send.mock.calls[0][0].body).toEqual({ order_sn: 'SHP1', cancel_reason: 'OTHER' });
    });

    it('treats an error inside the 200 as a refusal', async () => {
      send.mockResolvedValue({ status: 200, body: { error: 'error_cannot_cancel', message: 'Order already shipped', request_id: 'r1' } });

      const failure = await shopee.cancelOrder({ externalOrderId: 'SHP-SHIPPED' }).catch((err: MarketplaceRejectedError) => err);

      expect(failure).toBeInstanceOf(MarketplaceRejectedError);
      expect(failure).toMatchObject({ message: 'error_cannot_cancel: Order already shipped' });
    });

    it('lets the failure of the call through', async () => {
      const outage = new MarketplaceUnavailableError('HTTP 503', 'SHOPEE');
      send.mockRejectedValue(outage);

      await expect(shopee.cancelOrder({ externalOrderId: 'SHP1' })).rejects.toBe(outage);
    });
  });
});

describe('describeShopeeError', () => {
  it('names the code and the message of the error', () => {
    expect(describeShopeeError({ error: 'error_server', message: 'Service unavailable' })).toBe('error_server: Service unavailable');
  });

  it('names the code alone when there is no message', () => {
    expect(describeShopeeError({ error: 'error_server' })).toBe('error_server');
  });

  it.each([undefined, null, 'text', {}, { error: '', message: '' }])('has nothing to say about %p', body => {
    expect(describeShopeeError(body)).toBeUndefined();
  });
});
