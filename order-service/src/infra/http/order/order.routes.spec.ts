import express, { Express } from 'express';
import pino from 'pino';
import request from 'supertest';
import { OrderNotFoundError } from '../../../core/order/model/order.errors';
import { ListOrdersQuery, OrderPage, OrderView, QueryOrdersPort } from '../../../core/order/port/in/query-orders.port';
import { errorHandler } from '../error-handler';
import { OrderController } from './order.controller';
import { orderRoutes } from './order.routes';

const ORDER_ID = '6f1c2b8e-0000-4000-8000-000000000001';

const order = (overrides: Partial<OrderView> = {}): OrderView => ({
  id: ORDER_ID,
  marketplace: 'MERCADO_LIVRE',
  externalOrderId: 'ML-2000001',
  status: 'CANCELLED',
  total: 9060.97,
  items: [
    { sku: 'IPHONE-15', quantity: 2, unitPrice: 4500.5 },
    { sku: 'CASE-01', quantity: 3, unitPrice: 19.99 },
  ],
  cancellationReason: 'OUT_OF_STOCK',
  createdAt: new Date('2026-10-28T13:05:00Z'),
  updatedAt: new Date('2026-10-28T13:05:02Z'),
  ...overrides,
});

class FakeQueryOrders implements QueryOrdersPort {
  found: OrderView | Error = order();
  page: OrderPage = { orders: [], limit: 20, offset: 0 };
  findCalls: string[] = [];
  listCalls: ListOrdersQuery[] = [];

  async find(id: string): Promise<OrderView> {
    this.findCalls.push(id);
    if (this.found instanceof Error) throw this.found;
    return this.found;
  }

  async list(query: ListOrdersQuery): Promise<OrderPage> {
    this.listCalls.push(query);
    return this.page;
  }
}

describe('order routes', () => {
  let port: FakeQueryOrders;
  let app: Express;

  beforeEach(() => {
    port = new FakeQueryOrders();
    app = express();
    app.use(orderRoutes(new OrderController(port)));
    app.use(errorHandler(pino({ level: 'silent' })));
  });

  describe('GET /orders/:id', () => {
    it('answers 200 with the order as the BFF reads it: money in reais, dates in ISO-8601 UTC, the reason', async () => {
      const response = await request(app).get(`/orders/${ORDER_ID}`);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.body).toEqual({
        id: ORDER_ID,
        marketplace: 'MERCADO_LIVRE',
        externalOrderId: 'ML-2000001',
        status: 'CANCELLED',
        total: 9060.97,
        items: [
          { sku: 'IPHONE-15', quantity: 2, unitPrice: 4500.5 },
          { sku: 'CASE-01', quantity: 3, unitPrice: 19.99 },
        ],
        cancellationReason: 'OUT_OF_STOCK',
        createdAt: '2026-10-28T13:05:00.000Z',
        updatedAt: '2026-10-28T13:05:02.000Z',
      });
      expect(port.findCalls).toEqual([ORDER_ID]);
    });

    it('shows a null cancellation reason for an order that is not cancelled', async () => {
      port.found = order({ status: 'PAID', cancellationReason: null });

      const response = await request(app).get(`/orders/${ORDER_ID}`);

      expect(response.body).toMatchObject({ status: 'PAID', cancellationReason: null });
    });

    it('answers 404 as problem+json when the order does not exist', async () => {
      port.found = new OrderNotFoundError(ORDER_ID);

      const response = await request(app).get(`/orders/${ORDER_ID}`);

      expect(response.status).toBe(404);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.body).toEqual({
        type: 'about:blank',
        title: 'Not Found',
        status: 404,
        detail: `Order ${ORDER_ID} not found.`,
        instance: `/orders/${ORDER_ID}`,
      });
    });

    it.each(['123', 'not-a-uuid', '6f1c2b8e-0000-4000-8000-00000000000g', `${ORDER_ID}0`])(
      'answers 400 naming the id when %s is not a UUID, without asking the port',
      async id => {
        const response = await request(app).get(`/orders/${id}`);

        expect(response.status).toBe(400);
        expect(response.headers['content-type']).toContain('application/problem+json');
        expect(response.body.errors).toEqual([{ path: 'id', message: 'must be a UUID' }]);
        expect(port.findCalls).toEqual([]);
      },
    );

    it('answers 500 without the message when the port fails', async () => {
      port.found = new Error('connection refused to order-db:5432');

      const response = await request(app).get(`/orders/${ORDER_ID}`);

      expect(response.status).toBe(500);
      expect(JSON.stringify(response.body)).not.toContain('order-db');
    });
  });

  describe('GET /orders', () => {
    it('answers 200 with the page the port gives, as { orders, limit, offset }', async () => {
      port.page = { orders: [order()], limit: 20, offset: 0 };

      const response = await request(app).get('/orders');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        orders: [JSON.parse(JSON.stringify(order()))],
        limit: 20,
        offset: 0,
      });
    });

    it('asks the port for the first page when no parameter is sent', async () => {
      await request(app).get('/orders');

      expect(port.listCalls).toEqual([{}]);
    });

    it('passes the filters, and the numbers read from the text, to the port', async () => {
      port.page = { orders: [], limit: 5, offset: 10 };

      const response = await request(app).get('/orders?marketplace=SHOPEE&status=PAID&limit=5&offset=10');

      expect(response.status).toBe(200);
      expect(port.listCalls).toEqual([{ marketplace: 'SHOPEE', status: 'PAID', limit: 5, offset: 10 }]);
      expect(response.body).toEqual({ orders: [], limit: 5, offset: 10 });
    });

    it.each([
      ['limit=1', { limit: 1 }],
      ['limit=100', { limit: 100 }],
      ['offset=0', { offset: 0 }],
      ['marketplace=AMAZON', { marketplace: 'AMAZON' }],
      ['status=CANCELLED', { status: 'CANCELLED' }],
      ['status=RECEIVED&status=', null],
    ])('accepts %s', async (query, expected) => {
      const response = await request(app).get(`/orders?${query}`);

      if (expected === null) {
        expect(response.status).toBe(400);
      } else {
        expect(response.status).toBe(200);
        expect(port.listCalls).toEqual([expected]);
      }
    });

    it('ignores the parameters it does not know', async () => {
      await request(app).get('/orders?status=PAID&sort=asc&foo=1');

      expect(port.listCalls).toEqual([{ status: 'PAID' }]);
    });

    it('answers 400 as problem+json naming each invalid parameter, without asking the port', async () => {
      const response = await request(app).get('/orders?limit=0&offset=-1&marketplace=EBAY&status=SHIPPED');

      expect(response.status).toBe(400);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.body).toMatchObject({
        type: 'about:blank',
        title: 'Bad Request',
        status: 400,
        detail: 'Request validation failed.',
        instance: '/orders?limit=0&offset=-1&marketplace=EBAY&status=SHIPPED',
      });
      expect(response.body.errors.map((error: { path: string }) => error.path).sort()).toEqual([
        'limit', 'marketplace', 'offset', 'status',
      ]);
      expect(port.listCalls).toEqual([]);
    });

    it.each([
      ['limit=101', 'limit'],
      ['limit=abc', 'limit'],
      ['limit=1.5', 'limit'],
      ['limit=', 'limit'],
      ['limit=1e1', 'limit'],
      ['limit=1&limit=2', 'limit'],
      ['offset=-5', 'offset'],
      ['offset=', 'offset'],
      ['offset=1.5', 'offset'],
      ['offset=99999999999999999999', 'offset'],
      ['marketplace=amazon', 'marketplace'],
      ['marketplace=', 'marketplace'],
      ['status=paid', 'status'],
    ])('answers 400 for %s, naming %s', async (query, parameter) => {
      const response = await request(app).get(`/orders?${query}`);

      expect(response.status).toBe(400);
      expect(response.body.errors[0].path).toBe(parameter);
      expect(port.listCalls).toEqual([]);
    });

    it('says what each parameter must be', async () => {
      const response = await request(app).get('/orders?limit=101&marketplace=EBAY&status=SHIPPED&offset=x');

      const messages = Object.fromEntries(response.body.errors.map((error: { path: string; message: string }) => [error.path, error.message]));
      expect(messages).toEqual({
        limit: 'must be at most 100',
        marketplace: 'must be one of AMAZON, MERCADO_LIVRE, SHOPEE',
        status: 'must be one of RECEIVED, CONFIRMED, PAID, CANCELLED',
        offset: 'must be a whole number',
      });
    });
  });
});
