import { ValidationError } from '../shared/domain/domain.error';
import { OrderStatus } from './model/order-status.vo';
import { MarketplaceSales, OrderRepositoryPort, SalesPeriod } from './port/out/order.repository';
import { SalesReportFacade } from './sales-report.facade';

class SalesRepositoryStub implements Pick<OrderRepositoryPort, 'salesByMarketplace'> {
  rows: MarketplaceSales[] = [];
  periods: SalesPeriod[] = [];
  failWith: Error | null = null;

  async salesByMarketplace(period: SalesPeriod): Promise<MarketplaceSales[]> {
    if (this.failWith) throw this.failWith;
    this.periods.push(period);
    return this.rows;
  }
}

describe('SalesReportFacade', () => {
  let repository: SalesRepositoryStub;
  let facade: SalesReportFacade;

  beforeEach(() => {
    repository = new SalesRepositoryStub();
    facade = new SalesReportFacade(repository as unknown as OrderRepositoryPort);
  });

  it('gives one row per marketplace, in a fixed order, with zeros for the ones that sold nothing', async () => {
    const report = await facade.salesByMarketplace({ from: '2026-10-01', to: '2026-10-31' });

    expect(report).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
      marketplaces: [
        { marketplace: 'AMAZON', orders: 0, units: 0, totalAmount: 0 },
        { marketplace: 'MERCADO_LIVRE', orders: 0, units: 0, totalAmount: 0 },
        { marketplace: 'SHOPEE', orders: 0, units: 0, totalAmount: 0 },
      ],
    });
  });

  it('shows the orders, the units and the total in reais of the marketplaces that sold', async () => {
    repository.rows = [
      { marketplace: 'SHOPEE', orders: 2, units: 5, totalCents: 1_234_567 },
      { marketplace: 'MERCADO_LIVRE', orders: 1, units: 1, totalCents: 1_500_000 },
    ];

    const report = await facade.salesByMarketplace({ from: '2026-10-28', to: '2026-10-28' });

    expect(report.marketplaces).toEqual([
      { marketplace: 'AMAZON', orders: 0, units: 0, totalAmount: 0 },
      { marketplace: 'MERCADO_LIVRE', orders: 1, units: 1, totalAmount: 15000 },
      { marketplace: 'SHOPEE', orders: 2, units: 5, totalAmount: 12345.67 },
    ]);
  });

  it('asks for the days from the start of the first to the end of the last, as UTC', async () => {
    await facade.salesByMarketplace({ from: '2026-10-01', to: '2026-10-31' });

    expect(repository.periods).toHaveLength(1);
    expect(repository.periods[0].fromInclusive.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(repository.periods[0].toExclusive.toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('accepts a single day, and a period that crosses a leap day', async () => {
    await facade.salesByMarketplace({ from: '2028-02-29', to: '2028-02-29' });
    await facade.salesByMarketplace({ from: '2028-02-28', to: '2028-03-01' });

    expect(repository.periods[0].toExclusive.toISOString()).toBe('2028-03-01T00:00:00.000Z');
    expect(repository.periods[1].toExclusive.toISOString()).toBe('2028-03-02T00:00:00.000Z');
  });

  it('counts only the orders that have a reserved stock: CONFIRMED and PAID', async () => {
    await facade.salesByMarketplace({ from: '2026-10-01', to: '2026-10-31' });

    expect(repository.periods[0].statuses).toEqual([OrderStatus.CONFIRMED, OrderStatus.PAID]);
  });

  it('rejects a period that ends before it starts, asking nothing', async () => {
    await expect(facade.salesByMarketplace({ from: '2026-10-31', to: '2026-10-30' })).rejects.toThrow(ValidationError);
    expect(repository.periods).toEqual([]);
  });

  it.each([
    ['a missing day', undefined],
    ['an empty day', ''],
    ['a date with a time', '2026-10-01T00:00:00Z'],
    ['a day without leading zeros', '2026-1-1'],
    ['another format', '01/10/2026'],
    ['a day that does not exist', '2026-02-30'],
    ['a month that does not exist', '2026-13-01'],
    ['a leap day of a common year', '2026-02-29'],
  ])('rejects %s as a validation error, in from and in to', async (_, day) => {
    await expect(facade.salesByMarketplace({ from: day as string, to: '2026-12-31' })).rejects.toThrow(ValidationError);
    await expect(facade.salesByMarketplace({ from: '2026-01-01', to: day as string })).rejects.toThrow(ValidationError);
    expect(repository.periods).toEqual([]);
  });

  it('names the parameter that is wrong', async () => {
    await expect(facade.salesByMarketplace({ from: 'x', to: '2026-12-31' })).rejects.toThrow('from');
    await expect(facade.salesByMarketplace({ from: '2026-01-01', to: 'x' })).rejects.toThrow('to');
  });

  it('lets a failure of the repository through', async () => {
    repository.failWith = new Error('database is down');

    await expect(facade.salesByMarketplace({ from: '2026-10-01', to: '2026-10-31' })).rejects.toThrow('database is down');
  });
});
