import express, { Express } from 'express';
import pino from 'pino';
import request from 'supertest';
import { InvalidOrderError } from '../../../core/order/model/order.errors';
import { SalesReport, SalesReportPort, SalesReportPortInput } from '../../../core/order/port/in/sales-report.port';
import { errorHandler } from '../error-handler';
import { SalesReportController } from './sales-report.controller';
import { salesReportRoutes } from './sales-report.routes';

const report = (input: SalesReportPortInput): SalesReport => ({
  from: input.from,
  to: input.to,
  marketplaces: [
    { marketplace: 'AMAZON', orders: 0, units: 0, totalAmount: 0 },
    { marketplace: 'MERCADO_LIVRE', orders: 1, units: 1, totalAmount: 15000 },
    { marketplace: 'SHOPEE', orders: 2, units: 5, totalAmount: 12345.67 },
  ],
});

class FakeSalesReport implements SalesReportPort {
  calls: SalesReportPortInput[] = [];
  failWith: Error | null = null;

  async salesByMarketplace(input: SalesReportPortInput): Promise<SalesReport> {
    this.calls.push(input);
    if (this.failWith) throw this.failWith;
    return report(input);
  }
}

describe('GET /reports/sales-by-marketplace', () => {
  let port: FakeSalesReport;
  let app: Express;

  beforeEach(() => {
    port = new FakeSalesReport();
    app = express();
    app.use(salesReportRoutes(new SalesReportController(port)));
    app.use(errorHandler(pino({ level: 'silent' })));
  });

  it('answers 200 with the period and one row per marketplace, as the BFF reads it', async () => {
    const response = await request(app).get('/reports/sales-by-marketplace?from=2026-10-01&to=2026-10-31');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
      marketplaces: [
        { marketplace: 'AMAZON', orders: 0, units: 0, totalAmount: 0 },
        { marketplace: 'MERCADO_LIVRE', orders: 1, units: 1, totalAmount: 15000 },
        { marketplace: 'SHOPEE', orders: 2, units: 5, totalAmount: 12345.67 },
      ],
    });
    expect(port.calls).toEqual([{ from: '2026-10-01', to: '2026-10-31' }]);
  });

  it('accepts a period of a single day, and ignores the parameters it does not know', async () => {
    const response = await request(app).get('/reports/sales-by-marketplace?from=2026-10-28&to=2026-10-28&foo=1');

    expect(response.status).toBe(200);
    expect(port.calls).toEqual([{ from: '2026-10-28', to: '2026-10-28' }]);
  });

  it('answers 400 as problem+json naming each parameter that is missing', async () => {
    const response = await request(app).get('/reports/sales-by-marketplace');

    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body).toMatchObject({ type: 'about:blank', title: 'Bad Request', status: 400, detail: 'Request validation failed.' });
    expect(response.body.errors.map((error: { path: string }) => error.path).sort()).toEqual(['from', 'to']);
    expect(port.calls).toEqual([]);
  });

  it.each([
    ['2026-02-30', 'a day that does not exist'],
    ['2026-1-1', 'a day without leading zeros'],
    ['28/10/2026', 'another format'],
    ['2026-10-28T00:00:00Z', 'a date with a time'],
    ['', 'an empty value'],
    ['abc', 'text'],
  ])('answers 400 for %s (%s), naming the parameter that is wrong', async value => {
    const fromWrong = await request(app).get(`/reports/sales-by-marketplace?from=${encodeURIComponent(value)}&to=2026-12-31`);
    const toWrong = await request(app).get(`/reports/sales-by-marketplace?from=2026-01-01&to=${encodeURIComponent(value)}`);

    expect(fromWrong.status).toBe(400);
    expect(fromWrong.body.errors).toEqual([{ path: 'from', message: 'must be a day as YYYY-MM-DD' }]);
    expect(toWrong.status).toBe(400);
    expect(toWrong.body.errors).toEqual([{ path: 'to', message: 'must be a day as YYYY-MM-DD' }]);
    expect(port.calls).toEqual([]);
  });

  it('answers 400 naming the end of a period that ends before it starts', async () => {
    const response = await request(app).get('/reports/sales-by-marketplace?from=2026-10-31&to=2026-10-30');

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual([{ path: 'to', message: 'must not be before from' }]);
    expect(port.calls).toEqual([]);
  });

  it('answers 400 for both parameters that are wrong at once', async () => {
    const response = await request(app).get('/reports/sales-by-marketplace?from=x&to=y');

    expect(response.status).toBe(400);
    expect(response.body.errors.map((error: { path: string }) => error.path)).toEqual(['from', 'to']);
  });

  it('answers 422 when the facade refuses a period the route let through', async () => {
    port.failWith = new InvalidOrderError('Period must end on or after the day it starts.');

    const response = await request(app).get('/reports/sales-by-marketplace?from=2026-10-01&to=2026-10-31');

    expect(response.status).toBe(422);
  });

  it('answers 500 without the message when the port fails', async () => {
    port.failWith = new Error('connection refused to order-db:5432');

    const response = await request(app).get('/reports/sales-by-marketplace?from=2026-10-01&to=2026-10-31');

    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('order-db');
  });
});
