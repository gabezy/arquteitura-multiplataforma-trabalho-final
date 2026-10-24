import pino from 'pino';
import request from 'supertest';
import { QueryOrdersPort } from '../../core/order/port/in/query-orders.port';
import { SalesReportPort } from '../../core/order/port/in/sales-report.port';
import { createApp } from './app';
import { OrderController } from './order/order.controller';
import { SalesReportController } from './report/sales-report.controller';

const ORDER_ID = '6f1c2b8e-0000-4000-8000-000000000001';

describe('createApp', () => {
  const queryOrders: jest.Mocked<QueryOrdersPort> = { find: jest.fn(), list: jest.fn() };
  const salesReport: jest.Mocked<SalesReportPort> = { salesByMarketplace: jest.fn() };
  const app = createApp({
    logger: pino({ level: 'silent' }),
    checkDatabase: async () => undefined,
    orderController: new OrderController(queryOrders),
    salesReportController: new SalesReportController(salesReport),
  });

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('serves the health check, the order routes and the report route', async () => {
    queryOrders.find.mockResolvedValue({
      id: ORDER_ID, marketplace: 'AMAZON', externalOrderId: 'AMZ-1', status: 'PAID', total: 10, items: [],
      cancellationReason: null, createdAt: new Date('2026-10-28T13:05:00Z'), updatedAt: new Date('2026-10-28T13:05:02Z'),
    });
    queryOrders.list.mockResolvedValue({ orders: [], limit: 20, offset: 0 });
    salesReport.salesByMarketplace.mockResolvedValue({ from: '2026-10-01', to: '2026-10-31', marketplaces: [] });

    expect((await request(app).get('/health')).body).toEqual({ status: 'UP' });
    expect((await request(app).get(`/orders/${ORDER_ID}`)).body).toMatchObject({ id: ORDER_ID, status: 'PAID' });
    expect((await request(app).get('/orders')).body).toEqual({ orders: [], limit: 20, offset: 0 });
    expect((await request(app).get('/reports/sales-by-marketplace?from=2026-10-01&to=2026-10-31')).body).toEqual({
      from: '2026-10-01', to: '2026-10-31', marketplaces: [],
    });
  });

  it('answers the errors of every route as problem+json', async () => {
    queryOrders.list.mockRejectedValue(new Error('connection refused to order-db:5432'));

    const invalid = await request(app).get('/reports/sales-by-marketplace?from=2026-10-31&to=2026-10-01');
    const unexpected = await request(app).get('/orders');

    expect(invalid.status).toBe(400);
    expect(invalid.headers['content-type']).toContain('application/problem+json');
    expect(unexpected.status).toBe(500);
    expect(unexpected.headers['content-type']).toContain('application/problem+json');
  });

  it('answers 404 for a route it does not have', async () => {
    expect((await request(app).get('/products')).status).toBe(404);
  });
});
