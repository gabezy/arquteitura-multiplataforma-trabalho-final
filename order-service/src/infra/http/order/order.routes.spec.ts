import express from 'express';
import pino from 'pino';
import request from 'supertest';
import { OrderNotFoundError } from '../../../core/order/model/order.errors';
import { GetOrderPort } from '../../../core/order/port/in/get-order.port';
import { ListOrdersPort } from '../../../core/order/port/in/list-orders.port';
import { OrderOutput } from '../../../core/order/port/in/order.output';
import { errorHandler } from '../error-handler';
import { orderRoutes } from './order.routes';

const ORDER_ID = '6f1c2b8e-0000-4000-8000-000000000004';

const ORDER: OrderOutput = {
  id: ORDER_ID,
  marketplace: 'AMAZON',
  externalOrderId: 'AMZ-1000002',
  status: 'RECEIVED',
  total: 18689.9,
  items: [
    { sku: 'OXI-001', quantity: 1, unitPrice: 189.9 },
    { sku: 'MON-002', quantity: 1, unitPrice: 18500 },
  ],
  cancellationReason: null,
  orderedAt: new Date('2026-10-27T10:59:00Z'),
  createdAt: new Date('2026-10-27T11:00:00Z'),
  updatedAt: new Date('2026-10-27T11:00:06Z'),
};

const ORDER_JSON = {
  id: ORDER_ID,
  marketplace: 'AMAZON',
  externalOrderId: 'AMZ-1000002',
  status: 'RECEIVED',
  total: 18689.9,
  items: [
    { sku: 'OXI-001', quantity: 1, unitPrice: 189.9 },
    { sku: 'MON-002', quantity: 1, unitPrice: 18500 },
  ],
  cancellationReason: null,
  orderedAt: '2026-10-27T10:59:00.000Z',
  createdAt: '2026-10-27T11:00:00.000Z',
  updatedAt: '2026-10-27T11:00:06.000Z',
};

describe('order routes', () => {
  const listOrders: jest.Mocked<ListOrdersPort> = { list: jest.fn() };
  const getOrder: jest.Mocked<GetOrderPort> = { get: jest.fn() };
  const app = express().use(orderRoutes(listOrders, getOrder)).use(errorHandler(pino({ level: 'silent' })));

  const expectProblem = (response: request.Response, status: number): void => {
    expect(response.status).toBe(status);
    expect(response.type).toBe('application/problem+json');
    expect(response.body).toEqual(expect.objectContaining({ status }));
  };

  beforeEach(() => {
    jest.resetAllMocks();
    listOrders.list.mockResolvedValue([ORDER]);
  });

  describe('GET /orders', () => {
    it('answers 200 with the orders and the default page', async () => {
      const response = await request(app).get('/orders');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ orders: [ORDER_JSON], limit: 20, offset: 0 });
      expect(listOrders.list).toHaveBeenCalledWith({}, { limit: 20, offset: 0 });
    });

    it('passes the filters and the page to the port and echoes the page', async () => {
      const response = await request(app).get('/orders?marketplace=SHOPEE&status=CANCELLED&limit=5&offset=10');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(expect.objectContaining({ limit: 5, offset: 10 }));
      expect(listOrders.list).toHaveBeenCalledWith({ marketplace: 'SHOPEE', status: 'CANCELLED' }, { limit: 5, offset: 10 });
    });

    it.each(['RECEIVED', 'CONFIRMED', 'PAID', 'CANCELLED'])('accepts the status %s', async status => {
      expect((await request(app).get(`/orders?status=${status}`)).status).toBe(200);
    });

    it.each(['AMAZON', 'MERCADO_LIVRE', 'SHOPEE'])('accepts the marketplace %s', async marketplace => {
      expect((await request(app).get(`/orders?marketplace=${marketplace}`)).status).toBe(200);
    });

    it.each(['1', '100'])('accepts a limit of %s', async limit => {
      expect((await request(app).get(`/orders?limit=${limit}`)).status).toBe(200);
    });

    it.each([
      'limit=0',
      'limit=101',
      'limit=abc',
      'limit=1.5',
      'offset=-1',
      'offset=abc',
      'marketplace=EBAY',
      'marketplace=amazon',
      'status=SHIPPED',
    ])('answers 422 problem+json for %s', async query => {
      const response = await request(app).get(`/orders?${query}`);

      expectProblem(response, 422);
      expect(listOrders.list).not.toHaveBeenCalled();
    });

    it('answers 200 with an empty list when the page is past the last order', async () => {
      listOrders.list.mockResolvedValue([]);

      const response = await request(app).get('/orders?offset=500');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ orders: [], limit: 20, offset: 500 });
    });
  });

  describe('GET /orders/:id', () => {
    it('answers 200 with the order', async () => {
      getOrder.get.mockResolvedValue(ORDER);

      const response = await request(app).get(`/orders/${ORDER_ID}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(ORDER_JSON);
      expect(getOrder.get).toHaveBeenCalledWith(ORDER_ID);
    });

    it('answers 404 problem+json for an unknown order', async () => {
      getOrder.get.mockRejectedValue(new OrderNotFoundError(ORDER_ID));

      expectProblem(await request(app).get(`/orders/${ORDER_ID}`), 404);
    });

    it('answers 422 problem+json for an id that is not a UUID', async () => {
      const response = await request(app).get('/orders/abc');

      expectProblem(response, 422);
      expect(getOrder.get).not.toHaveBeenCalled();
    });
  });
});
