import pino from 'pino';
import { Marketplace } from '../../core/marketplace/model/marketplace';
import {
    StockSyncResult,
    SyncListingStockInput,
    SyncListingStockPort,
} from '../../core/listing/port/in/sync-listing-stock.port';
import { StockSynchronizers } from './stock-synchronizers';

const INTERVAL_MS = 2000;
const NOTHING: StockSyncResult = { pending: 0, synced: 0, failures: [] };

describe('StockSynchronizers', () => {
  const lines: { level: number; msg: string; marketplace?: string; pending?: number; synced?: number; failed?: number; listingId?: string; sku?: string; attempts?: number; reason?: string }[] = [];
  const logger = pino({ level: 'info' }, { write: (line: string) => lines.push(JSON.parse(line)) });
  let sync: jest.Mock<Promise<StockSyncResult>, [SyncListingStockInput]>;
  let synchronizers: StockSynchronizers;

  const roundsOf = (marketplace: Marketplace) => sync.mock.calls.filter(([input]) => input.marketplace === marketplace).length;

  beforeEach(() => {
    jest.useFakeTimers();
    lines.length = 0;
    sync = jest.fn().mockResolvedValue(NOTHING);
    synchronizers = new StockSynchronizers({ sync } as SyncListingStockPort, ['AMAZON', 'MERCADO_LIVRE', 'SHOPEE'], INTERVAL_MS, logger);
  });

  afterEach(async () => {
    await synchronizers.stop();
    jest.useRealTimers();
  });

  it('syncs every marketplace at once, and again every interval', async () => {
    synchronizers.start();
    await jest.advanceTimersByTimeAsync(0);

    expect(sync.mock.calls.map(([input]) => input.marketplace).sort()).toEqual(['AMAZON', 'MERCADO_LIVRE', 'SHOPEE']);

    await jest.advanceTimersByTimeAsync(INTERVAL_MS);

    expect(sync).toHaveBeenCalledTimes(6);
  });

  it('says nothing while there is nothing to send', async () => {
    synchronizers.start();
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);

    expect(lines).toEqual([]);
  });

  it('tells how many listings it sent', async () => {
    sync.mockImplementation(async ({ marketplace }) => (marketplace === 'AMAZON' ? { pending: 3, synced: 3, failures: [] } : NOTHING));

    synchronizers.start();
    await jest.advanceTimersByTimeAsync(0);

    expect(lines).toEqual([expect.objectContaining({ level: 30, msg: 'Stock sent to the marketplace', marketplace: 'AMAZON', pending: 3, synced: 3 })]);
  });

  it('warns once per round, with the first failure, and goes on to the next round', async () => {
    const failure = (listingId: string) => ({ listingId, sku: 'NB-001', attempts: 3, reason: 'HTTP 503' });
    sync.mockImplementation(async ({ marketplace }) =>
      marketplace === 'SHOPEE' ? { pending: 3, synced: 1, failures: [failure('listing-1'), failure('listing-2')] } : NOTHING,
    );

    synchronizers.start();
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);

    expect(roundsOf('SHOPEE')).toBe(2);
    expect(lines.filter(line => line.level === 40)).toHaveLength(2);
    expect(lines.filter(line => line.level === 40)[0]).toMatchObject({
      marketplace: 'SHOPEE', pending: 3, failed: 2, listingId: 'listing-1', sku: 'NB-001', attempts: 3, reason: 'HTTP 503',
    });
  });

  it('does not delay the other marketplaces while one is slow', async () => {
    let shopeeRounds = 0;
    sync.mockImplementation(async ({ marketplace }) => {
      if (marketplace === 'SHOPEE' && shopeeRounds++ === 0) {
        await new Promise(resolve => setTimeout(resolve, 60_000));
      }
      return NOTHING;
    });

    synchronizers.start();
    await jest.advanceTimersByTimeAsync(3 * INTERVAL_MS);

    expect(roundsOf('SHOPEE')).toBe(1);
    expect(roundsOf('AMAZON')).toBe(4);
    expect(roundsOf('MERCADO_LIVRE')).toBe(4);

    await jest.advanceTimersByTimeAsync(60_000);
  });

  it('logs an error, and keeps going, when a round fails for a reason that is not the marketplace', async () => {
    sync.mockRejectedValueOnce(new Error('database down')).mockResolvedValue(NOTHING);

    synchronizers.start();
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);

    expect(lines.filter(line => line.level === 50)).toHaveLength(1);
    expect(sync).toHaveBeenCalledTimes(6);
  });

  it('stops syncing', async () => {
    synchronizers.start();
    await jest.advanceTimersByTimeAsync(0);

    await synchronizers.stop();
    await jest.advanceTimersByTimeAsync(10 * INTERVAL_MS);

    expect(sync).toHaveBeenCalledTimes(3);
  });
});
