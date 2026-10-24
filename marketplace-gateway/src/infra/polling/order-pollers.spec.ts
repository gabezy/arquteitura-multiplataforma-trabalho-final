import pino from 'pino';
import { Marketplace } from '../../core/marketplace/model/marketplace';
import { MarketplaceUnavailableError, CircuitOpenError } from '../../core/marketplace/model/marketplace.errors';
import {
    ReceiveMarketplaceOrdersInput,
    ReceiveMarketplaceOrdersOutput,
    ReceiveMarketplaceOrdersPort,
} from '../../core/order/port/in/receive-marketplace-orders.port';
import { OrderPollers } from './order-pollers';

const INTERVAL_MS = 5000;
const NOTHING: ReceiveMarketplaceOrdersOutput = { fetched: 0, received: 0, discarded: [] };

describe('OrderPollers', () => {
  const lines: { level: number; msg: string; marketplace?: string; attempts?: number; reason?: string; received?: number; externalOrderId?: string }[] = [];
  const logger = pino({ level: 'info' }, { write: (line: string) => lines.push(JSON.parse(line)) });
  let receive: jest.Mock<Promise<ReceiveMarketplaceOrdersOutput>, [ReceiveMarketplaceOrdersInput]>;
  let pollers: OrderPollers;

  const pollsOf = (marketplace: Marketplace) => receive.mock.calls.filter(([input]) => input.marketplace === marketplace).length;

  beforeEach(() => {
    jest.useFakeTimers();
    lines.length = 0;
    receive = jest.fn().mockResolvedValue(NOTHING);
    pollers = new OrderPollers({ receive } as ReceiveMarketplaceOrdersPort, ['AMAZON', 'MERCADO_LIVRE', 'SHOPEE'], INTERVAL_MS, logger);
  });

  afterEach(async () => {
    await pollers.stop();
    jest.useRealTimers();
  });

  it('polls every marketplace at once, and again every interval', async () => {
    pollers.start();
    await jest.advanceTimersByTimeAsync(0);

    expect(receive.mock.calls.map(([input]) => input.marketplace).sort()).toEqual(['AMAZON', 'MERCADO_LIVRE', 'SHOPEE']);

    await jest.advanceTimersByTimeAsync(INTERVAL_MS);

    expect(receive).toHaveBeenCalledTimes(6);
  });

  it('keeps polling a marketplace after it fails, and warns instead of crashing', async () => {
    receive.mockImplementation(async ({ marketplace }) => {
      if (marketplace === 'SHOPEE') {
        throw new MarketplaceUnavailableError('HTTP 503', 'SHOPEE', 3);
      }
      return NOTHING;
    });

    pollers.start();
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);

    expect(pollsOf('SHOPEE')).toBe(2);
    expect(lines.filter(line => line.level === 40)).toHaveLength(2);
    expect(lines[0]).toMatchObject({ level: 40, marketplace: 'SHOPEE', attempts: 3, reason: 'HTTP 503' });
  });

  it('does not delay the other marketplaces while one is slow', async () => {
    let shopeePolls = 0;
    receive.mockImplementation(async ({ marketplace }) => {
      if (marketplace === 'SHOPEE' && shopeePolls++ === 0) {
        await new Promise(resolve => setTimeout(resolve, 60_000));
      }
      return NOTHING;
    });

    pollers.start();
    await jest.advanceTimersByTimeAsync(3 * INTERVAL_MS);

    expect(pollsOf('SHOPEE')).toBe(1);
    expect(pollsOf('AMAZON')).toBe(4);
    expect(pollsOf('MERCADO_LIVRE')).toBe(4);

    await jest.advanceTimersByTimeAsync(60_000);
  });

  it('warns that the circuit is open without any attempt', async () => {
    receive.mockRejectedValue(new CircuitOpenError('AMAZON'));

    pollers.start();
    await jest.advanceTimersByTimeAsync(0);

    expect(lines.filter(line => line.marketplace === 'AMAZON')[0]).toMatchObject({ level: 40, attempts: 0, reason: 'Circuit open for AMAZON' });
  });

  it('logs an error, and keeps going, when something that is not the marketplace fails', async () => {
    receive.mockRejectedValueOnce(new Error('database down')).mockResolvedValue(NOTHING);

    pollers.start();
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);

    expect(lines.filter(line => line.level === 50)).toHaveLength(1);
    expect(receive).toHaveBeenCalledTimes(6);
  });

  it('warns about each order it discarded, and tells how many it received', async () => {
    receive.mockImplementation(async ({ marketplace }) =>
      marketplace === 'AMAZON'
        ? { fetched: 3, received: 2, discarded: [{ externalOrderId: '701-2', reason: 'An order needs at least one item.' }] }
        : NOTHING,
    );

    pollers.start();
    await jest.advanceTimersByTimeAsync(0);

    expect(lines).toEqual([
      expect.objectContaining({ level: 40, msg: 'Order discarded', marketplace: 'AMAZON', externalOrderId: '701-2', reason: 'An order needs at least one item.' }),
      expect.objectContaining({ level: 30, msg: 'Orders received', marketplace: 'AMAZON', received: 2 }),
    ]);
  });

  it('stops polling', async () => {
    pollers.start();
    await jest.advanceTimersByTimeAsync(0);

    await pollers.stop();
    await jest.advanceTimersByTimeAsync(10 * INTERVAL_MS);

    expect(receive).toHaveBeenCalledTimes(3);
  });
});
