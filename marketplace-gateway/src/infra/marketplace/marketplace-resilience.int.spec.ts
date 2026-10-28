import pino from 'pino';
import {
    CircuitOpenError,
    MarketplaceRejectedError,
    MarketplaceUnavailableError,
} from '../../core/marketplace/model/marketplace.errors';
import { MarketplacePort } from '../../core/marketplace/port/out/marketplace.port';
import { requestsTo, resetWiremock, simulateFailure, simulatorBaseUrl, SimulatedMarketplace } from '../testing/wiremock';
import { AmazonMarketplace, describeAmazonError } from './amazon.marketplace';
import { MarketplaceHttpClient } from './marketplace-http.client';
import { describeMercadoLivreError, MercadoLivreMarketplace } from './mercado-livre.marketplace';
import { ResilienceOptions, ResilientMarketplace } from './resilient-marketplace';
import { describeShopeeError, ShopeeMarketplace } from './shopee.marketplace';

const SINCE = new Date('2026-10-28T12:00:00.000Z');
const logger = pino({ level: 'silent' });
const DRAFT = { listingId: 'a3c1d5e2-7b4f-4c8a-9e10-2d3f4a5b6c7d', sku: 'NB-001', name: 'Notebook', description: 'Notebook 16GB RAM', price: 4500, stock: 2 };
const COOLDOWN_MS = 300;
const STOCK_UPDATE = { externalListingId: '412525791', sku: 'NB-001', stock: 1 };

// The policy of the gateway (3 attempts, a circuit that opens at 3 failures in a row), with the waits cut short.
const OPTIONS: ResilienceOptions = {
  maxAttempts: 3,
  baseDelayMs: 5,
  maxDelayMs: 10,
  maxRetryAfterMs: 50,
  breaker: { failureThreshold: 3, cooldownMs: COOLDOWN_MS },
};

const adapterFor = (marketplace: SimulatedMarketplace, timeoutMs: number): MarketplacePort => {
  const baseUrl = simulatorBaseUrl(marketplace);
  switch (marketplace) {
    case 'AMAZON':
      return new AmazonMarketplace(new MarketplaceHttpClient('AMAZON', { baseUrl, timeoutMs, describeError: describeAmazonError }), { sellerId: 'A1B2C3D4E5', marketplaceId: 'A2Q3Y263D00KWC' }, logger);
    case 'MERCADO_LIVRE':
      return new MercadoLivreMarketplace(new MarketplaceHttpClient('MERCADO_LIVRE', { baseUrl, timeoutMs, describeError: describeMercadoLivreError }), { sellerId: '2000' }, logger);
    case 'SHOPEE':
      return new ShopeeMarketplace(new MarketplaceHttpClient('SHOPEE', { baseUrl, timeoutMs, describeError: describeShopeeError }), { shopId: '1001' }, logger);
  }
};

const resilient = (marketplace: SimulatedMarketplace, timeoutMs = 2000) =>
  new ResilientMarketplace(adapterFor(marketplace, timeoutMs), OPTIONS, { logger });

const ORDERS_PATH: Record<SimulatedMarketplace, string> = {
  AMAZON: '/amazon/orders/v0/orders',
  MERCADO_LIVRE: '/mercadolivre/orders/search',
  SHOPEE: '/shopee/api/v2/order/get_order_list',
};

const SHIPPED_ID: Record<SimulatedMarketplace, string> = {
  AMAZON: '701-SHIPPED-1',
  MERCADO_LIVRE: '2000-SHIPPED',
  SHOPEE: 'SHP-SHIPPED-1',
};

const PUBLISH_PATH: Record<SimulatedMarketplace, string> = {
  AMAZON: '/amazon/listings/2021-08-01/items/A1B2C3D4E5/NB-001',
  MERCADO_LIVRE: '/mercadolivre/items',
  SHOPEE: '/shopee/api/v2/product/add_item',
};

const STOCK_PATH: Record<SimulatedMarketplace, string> = {
  AMAZON: '/amazon/listings/2021-08-01/items/A1B2C3D4E5/NB-001',
  MERCADO_LIVRE: '/mercadolivre/items/412525791',
  SHOPEE: '/shopee/api/v2/product/update_stock',
};

const CANCEL_PATH: Record<SimulatedMarketplace, string> = {
  AMAZON: `/amazon/orders/v0/orders/${SHIPPED_ID.AMAZON}/cancellation`,
  MERCADO_LIVRE: `/mercadolivre/orders/${SHIPPED_ID.MERCADO_LIVRE}`,
  SHOPEE: '/shopee/api/v2/order/cancel_order',
};

describe.each(['AMAZON', 'MERCADO_LIVRE', 'SHOPEE'] as const)('the resilience of the %s adapter against its simulator', marketplace => {
  const callsToMarketplace = async () => (await requestsTo(ORDERS_PATH[marketplace])).length;

  beforeEach(resetWiremock);

  it('answers at the first attempt when the marketplace is fine', async () => {
    await expect(resilient(marketplace).fetchNewOrders(SINCE)).resolves.toEqual([]);

    expect(await callsToMarketplace()).toBe(1);
  });

  it('tries again and answers on the third attempt when the marketplace fails twice (flaky)', async () => {
    await simulateFailure(marketplace, 'flaky');

    await expect(resilient(marketplace).fetchNewOrders(SINCE)).resolves.toEqual([]);

    expect(await callsToMarketplace()).toBe(3);
  });

  it('gives up after 3 attempts when the marketplace is unavailable', async () => {
    await simulateFailure(marketplace, 'unavailable');

    const failure = await resilient(marketplace).fetchNewOrders(SINCE).catch((err: MarketplaceUnavailableError) => err);

    expect(failure).toBeInstanceOf(MarketplaceUnavailableError);
    expect(failure).toMatchObject({ message: 'HTTP 503', attempts: 3 });
    expect(await callsToMarketplace()).toBe(3);
  });

  it('waits for the Retry-After, up to the limit, and gives up after 3 attempts when it keeps limiting', async () => {
    await simulateFailure(marketplace, 'throttled');
    const startedAt = Date.now();

    const failure = await resilient(marketplace).fetchNewOrders(SINCE).catch((err: MarketplaceUnavailableError) => err);

    expect(failure).toMatchObject({ message: 'HTTP 429', attempts: 3 });
    expect(await callsToMarketplace()).toBe(3);
    // The marketplace asks for 1 s, but the gateway waits 50 ms at most, twice.
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(100);
    expect(Date.now() - startedAt).toBeLessThan(1500);
  });

  it('gives up after 3 attempts when the marketplace takes longer than the timeout', async () => {
    await simulateFailure(marketplace, 'slow');

    const failure = await resilient(marketplace, 200).fetchNewOrders(SINCE).catch((err: MarketplaceUnavailableError) => err);

    expect(failure).toMatchObject({ message: `${marketplace} did not answer within 200 ms`, attempts: 3 });
    expect(await callsToMarketplace()).toBe(3);
  });

  it('publishes a listing on the third attempt, sending the same idempotency key every time (flaky)', async () => {
    await simulateFailure(marketplace, 'flaky');

    const { externalListingId } = await resilient(marketplace).publishListing(DRAFT);

    expect(externalListingId).not.toBe('');
    const requests = await requestsTo(PUBLISH_PATH[marketplace]);
    expect(requests).toHaveLength(3);
    expect(requests.map(request => request.headers['idempotency-key'])).toEqual([DRAFT.listingId, DRAFT.listingId, DRAFT.listingId]);
  });

  it('gives up publishing after 3 attempts when the marketplace is unavailable', async () => {
    await simulateFailure(marketplace, 'unavailable');

    const failure = await resilient(marketplace).publishListing(DRAFT).catch((err: MarketplaceUnavailableError) => err);

    expect(failure).toMatchObject({ message: 'HTTP 503', attempts: 3 });
    expect(await requestsTo(PUBLISH_PATH[marketplace])).toHaveLength(3);
  });

  it('updates the stock on the third attempt, sending the same stock every time (flaky)', async () => {
    await simulateFailure(marketplace, 'flaky');

    await expect(resilient(marketplace).updateStock(STOCK_UPDATE)).resolves.toBeUndefined();

    const requests = await requestsTo(STOCK_PATH[marketplace]);
    expect(requests).toHaveLength(3);
    expect(new Set(requests.map(request => request.body)).size).toBe(1);
  });

  it('gives up updating the stock after 3 attempts when the marketplace is unavailable', async () => {
    await simulateFailure(marketplace, 'unavailable');

    const failure = await resilient(marketplace).updateStock(STOCK_UPDATE).catch((err: MarketplaceUnavailableError) => err);

    expect(failure).toMatchObject({ message: 'HTTP 503', attempts: 3 });
    expect(await requestsTo(STOCK_PATH[marketplace])).toHaveLength(3);
  });

  it('does not try again when the marketplace refuses the listing', async () => {
    const failure = await resilient(marketplace).publishListing({ ...DRAFT, price: 0 }).catch((err: MarketplaceRejectedError) => err);

    expect(failure).toBeInstanceOf(MarketplaceRejectedError);
    expect(failure).toMatchObject({ attempts: 1 });
    expect(await requestsTo(PUBLISH_PATH[marketplace])).toHaveLength(1);
  });

  it('does not try again when the marketplace refuses the call', async () => {
    const failure = await resilient(marketplace).cancelOrder({ externalOrderId: SHIPPED_ID[marketplace] }).catch((err: MarketplaceRejectedError) => err);

    expect(failure).toBeInstanceOf(MarketplaceRejectedError);
    expect(failure).toMatchObject({ attempts: 1 });
    expect(await requestsTo(CANCEL_PATH[marketplace])).toHaveLength(1);
  });

  it('opens the circuit after 3 failures in a row, and then refuses without calling the marketplace', async () => {
    await simulateFailure(marketplace, 'unavailable');
    const adapter = resilient(marketplace);
    await adapter.fetchNewOrders(SINCE).catch(() => undefined);
    expect(await callsToMarketplace()).toBe(3);

    const failure = await adapter.fetchNewOrders(SINCE).catch((err: CircuitOpenError) => err);

    expect(failure).toBeInstanceOf(CircuitOpenError);
    expect(failure).toMatchObject({ message: `Circuit open for ${marketplace}`, attempts: 0 });
    expect(await callsToMarketplace()).toBe(3);
  });

  it('lets a call through after the cooldown and closes the circuit when the marketplace is back', async () => {
    await simulateFailure(marketplace, 'unavailable');
    const adapter = resilient(marketplace);
    await adapter.fetchNewOrders(SINCE).catch(() => undefined);
    await expect(adapter.fetchNewOrders(SINCE)).rejects.toThrow(CircuitOpenError);
    await simulateFailure(marketplace, 'off');

    await new Promise(resolve => setTimeout(resolve, COOLDOWN_MS + 50));

    await expect(adapter.fetchNewOrders(SINCE)).resolves.toEqual([]);
    await expect(adapter.fetchNewOrders(SINCE)).resolves.toEqual([]);
  });
});

describe('the circuits of different marketplaces', () => {
  beforeEach(resetWiremock);

  it('are independent: a marketplace that is down does not stop the others', async () => {
    await simulateFailure('SHOPEE', 'unavailable');
    const shopee = resilient('SHOPEE');
    const amazon = resilient('AMAZON');
    await shopee.fetchNewOrders(SINCE).catch(() => undefined);

    await expect(shopee.fetchNewOrders(SINCE)).rejects.toThrow(CircuitOpenError);
    await expect(amazon.fetchNewOrders(SINCE)).resolves.toEqual([]);
    await expect(resilient('MERCADO_LIVRE').fetchNewOrders(SINCE)).resolves.toEqual([]);
  });
});
