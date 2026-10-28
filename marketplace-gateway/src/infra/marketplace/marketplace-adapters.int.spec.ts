import pino from 'pino';
import {
    MarketplaceRejectedError,
    MarketplaceUnavailableError,
} from '../../core/marketplace/model/marketplace.errors';
import { MarketplacePort } from '../../core/marketplace/port/out/marketplace.port';
import {
    requestsTo,
    resetWiremock,
    simulateFailure,
    simulateOrder,
    simulatorBaseUrl,
    SimulatedMarketplace,
} from '../testing/wiremock';
import { AmazonMarketplace, describeAmazonError } from './amazon.marketplace';
import { MarketplaceHttpClient } from './marketplace-http.client';
import { describeMercadoLivreError, MercadoLivreMarketplace } from './mercado-livre.marketplace';
import { describeShopeeError, ShopeeMarketplace } from './shopee.marketplace';

const SINCE = new Date('2026-10-28T12:00:00.000Z');
const logger = pino({ level: 'silent' });

const DRAFT = {
  listingId: 'a3c1d5e2-7b4f-4c8a-9e10-2d3f4a5b6c7d',
  sku: 'NB-001',
  name: 'Notebook',
  description: 'Notebook 16GB RAM',
  price: 4500,
  stock: 2,
};

interface Subject {
  marketplace: SimulatedMarketplace;
  adapter: (timeoutMs: number) => MarketplacePort;
  ordersPath: string;
  listingQuery: Record<string, string>;
  ids: { order: string; shipped: string; unknown: string };
  cancel: { method: string; path: (id: string) => string; body: (id: string) => unknown };
  refusals: { shipped: string; unknown: string };
  publish: { method: string; path: string; externalListingId: RegExp; body: (draft: typeof DRAFT) => unknown; priceRefusal: string };
  updateStock: { method: string; path: (externalListingId: string) => string; body: (externalListingId: string, stock: number) => unknown };
}

const subjects: Subject[] = [
  {
    marketplace: 'AMAZON',
    adapter: timeoutMs =>
      new AmazonMarketplace(
        new MarketplaceHttpClient('AMAZON', { baseUrl: simulatorBaseUrl('AMAZON'), timeoutMs, describeError: describeAmazonError }),
        { sellerId: 'A1B2C3D4E5', marketplaceId: 'A2Q3Y263D00KWC' },
        logger,
      ),
    ordersPath: '/amazon/orders/v0/orders',
    listingQuery: { MarketplaceIds: 'A2Q3Y263D00KWC', CreatedAfter: SINCE.toISOString(), OrderStatuses: 'Unshipped' },
    ids: { order: '701-1111111-2222222', shipped: '701-SHIPPED-1', unknown: '701-UNKNOWN-1' },
    cancel: {
      method: 'POST',
      path: id => `/amazon/orders/v0/orders/${id}/cancellation`,
      body: () => ({ cancelReason: 'OUT_OF_STOCK' }),
    },
    refusals: { shipped: 'HTTP 409: InvalidInput: Order already shipped', unknown: 'HTTP 404: NotFound: Order not found' },
    publish: {
      method: 'PUT',
      path: '/amazon/listings/2021-08-01/items/A1B2C3D4E5/NB-001',
      externalListingId: /^B0[A-Z0-9]{8}$/,
      body: draft => ({
        productType: 'PRODUCT',
        attributes: {
          item_name: [{ value: draft.name }],
          product_description: [{ value: draft.description }],
          list_price: [{ currency: 'BRL', value: draft.price }],
          fulfillment_availability: [{ fulfillment_channel_code: 'DEFAULT', quantity: draft.stock }],
        },
      }),
      priceRefusal: 'HTTP 400: InvalidInput: list_price must be greater than zero',
    },
    updateStock: {
      method: 'PATCH',
      path: () => '/amazon/listings/2021-08-01/items/A1B2C3D4E5/NB-001',
      body: (_id, stock) => ({
        productType: 'PRODUCT',
        patches: [{ op: 'replace', path: '/attributes/fulfillment_availability', value: [{ fulfillment_channel_code: 'DEFAULT', quantity: stock }] }],
      }),
    },
  },
  {
    marketplace: 'MERCADO_LIVRE',
    adapter: timeoutMs =>
      new MercadoLivreMarketplace(
        new MarketplaceHttpClient('MERCADO_LIVRE', { baseUrl: simulatorBaseUrl('MERCADO_LIVRE'), timeoutMs, describeError: describeMercadoLivreError }),
        { sellerId: '2000' },
        logger,
      ),
    ordersPath: '/mercadolivre/orders/search',
    listingQuery: { seller: '2000', 'order.status': 'paid', 'order.date_created.from': SINCE.toISOString(), offset: '0', limit: '50' },
    ids: { order: '2000001', shipped: '2000-SHIPPED', unknown: '2000-UNKNOWN' },
    cancel: {
      method: 'PUT',
      path: id => `/mercadolivre/orders/${id}`,
      body: () => ({ status: 'cancelled', reason: 'OUT_OF_STOCK' }),
    },
    refusals: { shipped: 'HTTP 409: Order cannot be cancelled', unknown: 'HTTP 404: Order not found' },
    publish: {
      method: 'POST',
      path: '/mercadolivre/items',
      externalListingId: /^MLB\d{10}$/,
      body: draft => ({
        title: draft.name,
        category_id: 'MLB1648',
        price: draft.price,
        currency_id: 'BRL',
        available_quantity: draft.stock,
        buying_mode: 'buy_it_now',
        listing_type_id: 'gold_special',
        condition: 'new',
        description: { plain_text: draft.description },
        seller_custom_field: draft.sku,
      }),
      priceRefusal: 'HTTP 400: Validation error: Item price invalid',
    },
    updateStock: {
      method: 'PUT',
      path: id => `/mercadolivre/items/${id}`,
      body: (_id, stock) => ({ available_quantity: stock }),
    },
  },
  {
    marketplace: 'SHOPEE',
    adapter: timeoutMs =>
      new ShopeeMarketplace(
        new MarketplaceHttpClient('SHOPEE', { baseUrl: simulatorBaseUrl('SHOPEE'), timeoutMs, describeError: describeShopeeError }),
        { shopId: '1001' },
        logger,
      ),
    ordersPath: '/shopee/api/v2/order/get_order_list',
    listingQuery: { shop_id: '1001', time_range_field: 'create_time', order_status: 'READY_TO_SHIP', page_size: '100' },
    ids: { order: 'SHP261028A1B2C3', shipped: 'SHP-SHIPPED-1', unknown: 'SHP-UNKNOWN-1' },
    cancel: {
      method: 'POST',
      path: () => '/shopee/api/v2/order/cancel_order',
      body: id => ({ order_sn: id, cancel_reason: 'OUT_OF_STOCK' }),
    },
    refusals: { shipped: 'error_cannot_cancel: Order already shipped', unknown: 'error_not_found: Order not found' },
    publish: {
      method: 'POST',
      path: '/shopee/api/v2/product/add_item',
      externalListingId: /^\d{9}$/,
      body: draft => ({
        item_name: draft.name,
        description: draft.description,
        original_price: draft.price,
        normal_stock: draft.stock,
        item_sku: draft.sku,
        category_id: 100001,
      }),
      priceRefusal: 'error_param: original_price must be greater than 0',
    },
    updateStock: {
      method: 'POST',
      path: () => '/shopee/api/v2/product/update_stock',
      body: (id, stock) => ({ item_id: Number(id), stock_list: [{ model_id: 0, normal_stock: stock }] }),
    },
  },
];

describe.each(subjects)('the $marketplace adapter against its simulator', subject => {
  const { marketplace, ids } = subject;
  const adapter = subject.adapter(2000);

  beforeEach(resetWiremock);

  describe('publishing a listing', () => {
    it('gives the id the marketplace generated for the listing', async () => {
      const { externalListingId } = await adapter.publishListing(DRAFT);

      expect(externalListingId).toMatch(subject.publish.externalListingId);
    });

    it('sends the data of the product in the format of the marketplace, with the id of the listing as the idempotency key', async () => {
      await adapter.publishListing(DRAFT);

      const [request, ...others] = await requestsTo(subject.publish.path);
      expect(others).toEqual([]);
      expect(request.method).toBe(subject.publish.method);
      expect(request.headers).toMatchObject({ 'idempotency-key': DRAFT.listingId });
      expect(JSON.parse(request.body)).toEqual(subject.publish.body(DRAFT));
    });

    it('is refused when the price is zero, with the reason of the marketplace', async () => {
      const failure = await adapter.publishListing({ ...DRAFT, price: 0 }).catch((err: MarketplaceRejectedError) => err);

      expect(failure).toBeInstanceOf(MarketplaceRejectedError);
      expect((failure as Error).message).toBe(subject.publish.priceRefusal);
    });

    it('is unavailable when the marketplace answers 503', async () => {
      await simulateFailure(marketplace, 'unavailable');

      await expect(adapter.publishListing(DRAFT)).rejects.toThrow(MarketplaceUnavailableError);
    });
  });

  describe('updating the stock of a listing', () => {
    const listingAt = async () => {
      const { externalListingId } = await adapter.publishListing(DRAFT);
      await resetWiremock();
      return { externalListingId, sku: DRAFT.sku };
    };

    it('sends the stock in the format of the marketplace', async () => {
      const listing = await listingAt();

      await adapter.updateStock({ ...listing, stock: 1 });

      const [request, ...others] = await requestsTo(subject.updateStock.path(listing.externalListingId));
      expect(others).toEqual([]);
      expect(request.method).toBe(subject.updateStock.method);
      expect(JSON.parse(request.body)).toEqual(subject.updateStock.body(listing.externalListingId, 1));
    });

    it('sends a stock of zero as it is, to make the listing unavailable', async () => {
      const listing = await listingAt();

      await adapter.updateStock({ ...listing, stock: 0 });

      const [request] = await requestsTo(subject.updateStock.path(listing.externalListingId));
      expect(JSON.parse(request.body)).toEqual(subject.updateStock.body(listing.externalListingId, 0));
    });

    it('is unavailable when the marketplace answers 503', async () => {
      const listing = await listingAt();
      await simulateFailure(marketplace, 'unavailable');

      await expect(adapter.updateStock({ ...listing, stock: 1 })).rejects.toThrow(MarketplaceUnavailableError);
    });
  });

  describe('fetching new orders', () => {
    it('finds none while nobody simulated an order', async () => {
      await expect(adapter.fetchNewOrders(SINCE)).resolves.toEqual([]);
    });

    it('finds the order the script registered, translated to the canonical order', async () => {
      await simulateOrder(marketplace, { id: ids.order, sku: 'NB-001', qty: 2, price: '4500.50' });

      const orders = await adapter.fetchNewOrders(SINCE);

      expect(orders).toEqual([
        {
          externalOrderId: ids.order,
          items: [{ sku: 'NB-001', quantity: 2, unitPrice: 4500.5 }],
          total: 9001,
          orderedAt: expect.any(Date),
        },
      ]);
      expect(Math.abs(orders[0].orderedAt.getTime() - Date.now())).toBeLessThan(60_000);
    });

    it('finds every order the script registered', async () => {
      await simulateOrder(marketplace, { id: `${ids.order}-A` });
      await simulateOrder(marketplace, { id: `${ids.order}-B`, sku: 'IPHONE-15', qty: 7, price: '15000' });

      const orders = await adapter.fetchNewOrders(SINCE);

      expect(orders.map(order => order.externalOrderId)).toEqual([`${ids.order}-A`, `${ids.order}-B`]);
      expect(orders[1]).toMatchObject({ items: [{ sku: 'IPHONE-15', quantity: 7, unitPrice: 15000 }], total: 105000 });
    });

    it('asks for the paid orders not shipped yet, created since the instant, in the format of the marketplace', async () => {
      await adapter.fetchNewOrders(SINCE);

      const requests = await requestsTo(subject.ordersPath);
      expect(requests).toHaveLength(1);
      expect(requests[0].method).toBe('GET');
      expect(requests[0].queryParams).toMatchObject(subject.listingQuery);
    });
  });

  describe('cancelling an order', () => {
    it('sends the cancellation in the format of the marketplace', async () => {
      await adapter.cancelOrder({ externalOrderId: ids.order, reason: 'OUT_OF_STOCK' });

      const [request, ...others] = await requestsTo(subject.cancel.path(ids.order));
      expect(others).toEqual([]);
      expect(request.method).toBe(subject.cancel.method);
      expect(JSON.parse(request.body)).toEqual(subject.cancel.body(ids.order));
    });

    it('is refused when the order was already shipped, with the reason of the marketplace', async () => {
      const failure = await adapter.cancelOrder({ externalOrderId: ids.shipped }).catch((err: MarketplaceRejectedError) => err);

      expect(failure).toBeInstanceOf(MarketplaceRejectedError);
      expect((failure as Error).message).toBe(subject.refusals.shipped);
    });

    it('is refused when the marketplace does not know the order', async () => {
      const failure = await adapter.cancelOrder({ externalOrderId: ids.unknown }).catch((err: MarketplaceRejectedError) => err);

      expect(failure).toBeInstanceOf(MarketplaceRejectedError);
      expect((failure as Error).message).toBe(subject.refusals.unknown);
    });
  });

  describe('a marketplace in trouble', () => {
    it('is unavailable when it answers 503', async () => {
      await simulateFailure(marketplace, 'unavailable');

      const failure = await adapter.fetchNewOrders(SINCE).catch((err: MarketplaceUnavailableError) => err);

      expect(failure).toBeInstanceOf(MarketplaceUnavailableError);
      expect(failure).toMatchObject({ message: 'HTTP 503', retryAfterMs: undefined });
    });

    it('is unavailable, and says how long to wait, when it answers 429', async () => {
      await simulateFailure(marketplace, 'throttled');

      const failure = await adapter.cancelOrder({ externalOrderId: ids.order }).catch((err: MarketplaceUnavailableError) => err);

      expect(failure).toBeInstanceOf(MarketplaceUnavailableError);
      expect(failure).toMatchObject({ message: 'HTTP 429', retryAfterMs: 1000 });
    });

    it('is unavailable when it takes longer than the timeout', async () => {
      await simulateFailure(marketplace, 'slow');

      const failure = await subject.adapter(300).fetchNewOrders(SINCE).catch((err: MarketplaceUnavailableError) => err);

      expect(failure).toBeInstanceOf(MarketplaceUnavailableError);
      expect(failure).toMatchObject({ message: `${marketplace} did not answer within 300 ms` });
    });

    it('fails the first two calls and answers the third, in flaky mode', async () => {
      await simulateFailure(marketplace, 'flaky');

      await expect(adapter.fetchNewOrders(SINCE)).rejects.toThrow(MarketplaceUnavailableError);
      await expect(adapter.fetchNewOrders(SINCE)).rejects.toThrow(MarketplaceUnavailableError);
      await expect(adapter.fetchNewOrders(SINCE)).resolves.toEqual([]);
      await expect(adapter.fetchNewOrders(SINCE)).resolves.toEqual([]);
    });

    it('answers again when the failure is turned off', async () => {
      await simulateFailure(marketplace, 'unavailable');
      await expect(adapter.fetchNewOrders(SINCE)).rejects.toThrow(MarketplaceUnavailableError);

      await simulateFailure(marketplace, 'off');

      await expect(adapter.fetchNewOrders(SINCE)).resolves.toEqual([]);
    });
  });
});

describe('the failure of one simulator', () => {
  beforeEach(resetWiremock);

  it('leaves the others answering', async () => {
    const [amazon, , shopee] = subjects.map(subject => subject.adapter(2000));
    await simulateFailure('SHOPEE', 'unavailable');

    await expect(shopee.fetchNewOrders(SINCE)).rejects.toThrow(MarketplaceUnavailableError);
    await expect(amazon.fetchNewOrders(SINCE)).resolves.toEqual([]);
  });

  it('is turned off for all of them at once', async () => {
    await simulateFailure('all', 'unavailable');
    await simulateFailure('all', 'off');

    for (const subject of subjects) {
      await expect(subject.adapter(2000).fetchNewOrders(SINCE)).resolves.toEqual([]);
    }
  });
});
