import pino from 'pino';
import { Marketplace } from '../../core/marketplace/model/marketplace';
import {
    CircuitOpenError,
    MarketplaceRejectedError,
    MarketplaceUnavailableError,
} from '../../core/marketplace/model/marketplace.errors';
import { CanonicalOrder, MarketplacePort } from '../../core/marketplace/port/out/marketplace.port';
import { ResilienceOptions, ResilientMarketplace } from './resilient-marketplace';

const OPTIONS: ResilienceOptions = {
  maxAttempts: 3,
  baseDelayMs: 200,
  maxDelayMs: 2000,
  maxRetryAfterMs: 5000,
  breaker: { failureThreshold: 5, cooldownMs: 30_000 },
};
const SINCE = new Date('2026-10-28T13:00:00Z');
const REQUEST = { externalOrderId: 'SHP1', reason: 'OUT_OF_STOCK' };
const DRAFT = { listingId: 'a3c1d5e2-7b4f-4c8a-9e10-2d3f4a5b6c7d', sku: 'NB-001', name: 'Notebook', description: 'Notebook 16GB RAM', price: 4500, stock: 2 };

const unavailable = (retryAfterMs?: number, marketplace: Marketplace = 'SHOPEE') =>
  new MarketplaceUnavailableError('HTTP 503', marketplace, 1, retryAfterMs);
const rejected = () => new MarketplaceRejectedError('HTTP 409: Order already shipped', 'SHOPEE');

describe('ResilientMarketplace', () => {
  let inner: jest.Mocked<MarketplacePort>;
  let sleep: jest.Mock<Promise<void>, [number]>;
  let random: jest.Mock<number, []>;
  let nowMs: number;

  const decorate = (port: MarketplacePort = inner, options: ResilienceOptions = OPTIONS) =>
    new ResilientMarketplace(port, options, { logger: pino({ level: 'silent' }), sleep, random, now: () => nowMs });

  const portOf = (marketplace: Marketplace): jest.Mocked<MarketplacePort> => ({
    marketplace,
    publishListing: jest.fn(),
    updateStock: jest.fn(),
    fetchNewOrders: jest.fn(),
    cancelOrder: jest.fn(),
  });

  beforeEach(() => {
    inner = portOf('SHOPEE');
    sleep = jest.fn().mockResolvedValue(undefined);
    random = jest.fn().mockReturnValue(1);
    nowMs = 1_000_000;
  });

  it('is the marketplace it decorates', () => {
    expect(decorate().marketplace).toBe('SHOPEE');
  });

  describe('when the call works', () => {
    it('answers what the marketplace answered, with one call and no wait', async () => {
      const orders: CanonicalOrder[] = [{ externalOrderId: 'SHP1', items: [], total: 0, orderedAt: SINCE }];
      inner.fetchNewOrders.mockResolvedValue(orders);

      await expect(decorate().fetchNewOrders(SINCE)).resolves.toBe(orders);

      expect(inner.fetchNewOrders).toHaveBeenCalledTimes(1);
      expect(inner.fetchNewOrders).toHaveBeenCalledWith(SINCE);
      expect(sleep).not.toHaveBeenCalled();
    });

    it('passes the cancellation on', async () => {
      await decorate().cancelOrder(REQUEST);

      expect(inner.cancelOrder).toHaveBeenCalledWith(REQUEST);
    });

    it('passes the listing on and answers the id the marketplace gave', async () => {
      inner.publishListing.mockResolvedValue({ externalListingId: '412525791' });

      await expect(decorate().publishListing(DRAFT)).resolves.toEqual({ externalListingId: '412525791' });

      expect(inner.publishListing).toHaveBeenCalledWith(DRAFT);
    });
  });

  describe('retry', () => {
    it('passes the stock update on, and tries it again after a transient failure', async () => {
      const update = { externalListingId: '412525791', sku: 'NB-001', stock: 0 };
      inner.updateStock.mockRejectedValueOnce(unavailable()).mockResolvedValueOnce();

      await expect(decorate().updateStock(update)).resolves.toBeUndefined();

      expect(inner.updateStock.mock.calls).toEqual([[update], [update]]);
    });

    it('tries a listing again with the very same draft, so its idempotency key does not change', async () => {
      inner.publishListing.mockRejectedValueOnce(unavailable()).mockResolvedValueOnce({ externalListingId: '1' });

      await decorate().publishListing(DRAFT);

      expect(inner.publishListing.mock.calls).toEqual([[DRAFT], [DRAFT]]);
    });

    it('tries again after a transient failure and answers when a later attempt works', async () => {
      inner.cancelOrder.mockRejectedValueOnce(unavailable()).mockRejectedValueOnce(unavailable()).mockResolvedValueOnce();

      await expect(decorate().cancelOrder(REQUEST)).resolves.toBeUndefined();

      expect(inner.cancelOrder).toHaveBeenCalledTimes(3);
    });

    it('waits 200 ms and then 400 ms, at most, between the attempts', async () => {
      inner.cancelOrder.mockRejectedValue(unavailable());

      await expect(decorate().cancelOrder(REQUEST)).rejects.toThrow();

      expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([200, 400]);
    });

    it('waits a random time up to that limit (jitter)', async () => {
      random.mockReturnValue(0.5);
      inner.cancelOrder.mockRejectedValue(unavailable());

      await expect(decorate().cancelOrder(REQUEST)).rejects.toThrow();

      expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([100, 200]);
    });

    it('never waits longer than the maximum delay', async () => {
      inner.cancelOrder.mockRejectedValue(unavailable());

      await expect(decorate(inner, { ...OPTIONS, maxDelayMs: 300 }).cancelOrder(REQUEST)).rejects.toThrow();

      expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([200, 300]);
    });

    it('gives up after 3 attempts, with the last reason and the number of attempts made', async () => {
      inner.cancelOrder.mockRejectedValue(unavailable());

      const failure = await decorate().cancelOrder(REQUEST).catch((err: MarketplaceUnavailableError) => err);

      expect(failure).toBeInstanceOf(MarketplaceUnavailableError);
      expect(failure).toMatchObject({ message: 'HTTP 503', attempts: 3, marketplace: 'SHOPEE' });
      expect(inner.cancelOrder).toHaveBeenCalledTimes(3);
      expect(sleep).toHaveBeenCalledTimes(2);
    });

    it('waits at least the Retry-After of a 429', async () => {
      random.mockReturnValue(0);
      inner.cancelOrder.mockRejectedValueOnce(unavailable(1000)).mockResolvedValueOnce();

      await decorate().cancelOrder(REQUEST);

      expect(sleep).toHaveBeenCalledWith(1000);
    });

    it('waits the backoff when it is longer than the Retry-After', async () => {
      inner.cancelOrder.mockRejectedValueOnce(unavailable(50)).mockResolvedValueOnce();

      await decorate().cancelOrder(REQUEST);

      expect(sleep).toHaveBeenCalledWith(200);
    });

    it('never waits more than 5 s, whatever the Retry-After says', async () => {
      inner.cancelOrder.mockRejectedValueOnce(unavailable(60_000)).mockResolvedValueOnce();

      await decorate().cancelOrder(REQUEST);

      expect(sleep).toHaveBeenCalledWith(5000);
    });

    it('does not try again after a rejection: the call is wrong, not the marketplace', async () => {
      inner.cancelOrder.mockRejectedValue(rejected());

      const failure = await decorate().cancelOrder(REQUEST).catch((err: MarketplaceRejectedError) => err);

      expect(failure).toBeInstanceOf(MarketplaceRejectedError);
      expect(failure).toMatchObject({ message: 'HTTP 409: Order already shipped', attempts: 1 });
      expect(inner.cancelOrder).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    });

    it('does not try again after an error that is not the marketplace\'s', async () => {
      inner.cancelOrder.mockRejectedValue(new TypeError('bug'));

      await expect(decorate().cancelOrder(REQUEST)).rejects.toThrow(TypeError);

      expect(inner.cancelOrder).toHaveBeenCalledTimes(1);
    });
  });

  describe('circuit breaker', () => {
    const failCalls = async (resilient: ResilientMarketplace, times: number) => {
      for (let i = 0; i < times; i++) {
        await resilient.cancelOrder(REQUEST).catch(() => undefined);
      }
    };

    it('opens after 5 failures in a row and then refuses at once, without calling the marketplace', async () => {
      inner.cancelOrder.mockRejectedValue(unavailable());
      const resilient = decorate();
      await failCalls(resilient, 2);
      inner.cancelOrder.mockClear();

      const failure = await resilient.cancelOrder(REQUEST).catch((err: CircuitOpenError) => err);

      expect(failure).toBeInstanceOf(CircuitOpenError);
      expect(failure).toMatchObject({ message: 'Circuit open for SHOPEE', attempts: 0, marketplace: 'SHOPEE' });
      expect(inner.cancelOrder).not.toHaveBeenCalled();
    });

    it('stops retrying the call that opened it', async () => {
      inner.cancelOrder.mockRejectedValue(unavailable());
      const resilient = decorate();

      await failCalls(resilient, 1);
      expect(inner.cancelOrder).toHaveBeenCalledTimes(3);
      inner.cancelOrder.mockClear();
      sleep.mockClear();

      const failure = await resilient.cancelOrder(REQUEST).catch((err: MarketplaceUnavailableError) => err);

      expect(failure).toMatchObject({ attempts: 2 });
      expect(inner.cancelOrder).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledTimes(1);
    });

    it('refuses the polls too while it is open', async () => {
      inner.cancelOrder.mockRejectedValue(unavailable());
      const resilient = decorate();
      await failCalls(resilient, 2);

      await expect(resilient.fetchNewOrders(SINCE)).rejects.toThrow(CircuitOpenError);
      expect(inner.fetchNewOrders).not.toHaveBeenCalled();
    });

    it('lets one call through after 30 s, and closes when it works', async () => {
      inner.cancelOrder.mockRejectedValue(unavailable());
      const resilient = decorate();
      await failCalls(resilient, 2);
      nowMs += 30_000;
      inner.cancelOrder.mockReset().mockResolvedValue();

      await expect(resilient.cancelOrder(REQUEST)).resolves.toBeUndefined();
      await expect(resilient.cancelOrder(REQUEST)).resolves.toBeUndefined();

      expect(inner.cancelOrder).toHaveBeenCalledTimes(2);
    });

    it('opens again when the call that went through after 30 s fails', async () => {
      inner.cancelOrder.mockRejectedValue(unavailable());
      const resilient = decorate();
      await failCalls(resilient, 2);
      nowMs += 30_000;
      inner.cancelOrder.mockClear();

      await expect(resilient.cancelOrder(REQUEST)).rejects.toMatchObject({ message: 'HTTP 503', attempts: 1 });
      await expect(resilient.cancelOrder(REQUEST)).rejects.toThrow(CircuitOpenError);

      expect(inner.cancelOrder).toHaveBeenCalledTimes(1);
    });

    it('is not opened by the failures of another marketplace', async () => {
      const amazon = portOf('AMAZON');
      amazon.cancelOrder.mockResolvedValue();
      inner.cancelOrder.mockRejectedValue(unavailable());
      const shopeeResilient = decorate();
      const amazonResilient = decorate(amazon);
      await failCalls(shopeeResilient, 2);

      await expect(shopeeResilient.cancelOrder(REQUEST)).rejects.toThrow(CircuitOpenError);
      await expect(amazonResilient.cancelOrder(REQUEST)).resolves.toBeUndefined();
    });

    // One attempt per call, so each call is one failure in the count.
    const SINGLE_ATTEMPT: ResilienceOptions = { ...OPTIONS, maxAttempts: 1 };

    it('counts a rejection as a call that worked', async () => {
      const resilient = decorate(inner, SINGLE_ATTEMPT);
      inner.cancelOrder.mockRejectedValue(unavailable());
      await failCalls(resilient, 4);
      inner.cancelOrder.mockRejectedValueOnce(rejected());
      await failCalls(resilient, 1);
      await failCalls(resilient, 4);
      inner.cancelOrder.mockClear();

      await resilient.cancelOrder(REQUEST).catch(() => undefined);

      // 4 + 4 failures would have opened it, had the rejection not started the count again.
      expect(inner.cancelOrder).toHaveBeenCalledTimes(1);
    });

    it('starts the count again after a call that works', async () => {
      const resilient = decorate(inner, SINGLE_ATTEMPT);
      inner.cancelOrder.mockRejectedValue(unavailable());
      await failCalls(resilient, 4);
      inner.cancelOrder.mockResolvedValueOnce();
      await resilient.cancelOrder(REQUEST);
      await failCalls(resilient, 4);
      inner.cancelOrder.mockClear();

      await resilient.cancelOrder(REQUEST).catch(() => undefined);

      expect(inner.cancelOrder).toHaveBeenCalledTimes(1);
    });
  });
});
