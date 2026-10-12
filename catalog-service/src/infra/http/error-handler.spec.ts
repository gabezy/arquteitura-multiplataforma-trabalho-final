import express, { Express } from 'express';
import pino from 'pino';
import request from 'supertest';
import { z } from 'zod';
import { errorHandler } from './error-handler';
import { RequestValidationError } from './validate';
import { ConflictError, NotFoundError, ValidationError } from '../../core/shared/domain/domain.error';
import { InsufficientStockError, InvalidProductError, ProductNotFoundError } from '../../core/product/model/product.errors';

const appThrowing = (error: unknown): Express => {
  const app = express();
  app.use(express.json());
  app.post('/boom', () => {
    throw error;
  });
  app.use(errorHandler(pino({ level: 'silent' })));
  return app;
};

describe('errorHandler', () => {
  it.each([
    [new ValidationError('Price must be a non-negative number.'), 422, 'Unprocessable Entity'],
    [new InvalidProductError('Product name is required.'), 422, 'Unprocessable Entity'],
    [new NotFoundError('Category not found.'), 404, 'Not Found'],
    [new ProductNotFoundError('product-1'), 404, 'Not Found'],
    [new ConflictError('Already approved.'), 409, 'Conflict'],
    [new InsufficientStockError(), 409, 'Conflict'],
  ])('maps %p to %i', async (error, status, title) => {
    const response = await request(appThrowing(error)).post('/boom');

    expect(response.status).toBe(status);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body).toEqual({
      type: 'about:blank',
      title,
      status,
      detail: error.message,
      instance: '/boom',
    });
  });

  it('maps a RequestValidationError to 400 with the invalid fields', async () => {
    const parsed = z.object({ name: z.string() }).safeParse({});
    if (parsed.success) throw new Error('expected the parse to fail');

    const response = await request(appThrowing(new RequestValidationError(parsed.error))).post('/boom');

    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body).toEqual({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: 'Request validation failed.',
      instance: '/boom',
      errors: [{ path: 'name', message: expect.any(String) }],
    });
  });

  it('returns 400 for a malformed JSON body', async () => {
    const response = await request(appThrowing(new Error('unreachable')))
      .post('/boom')
      .set('Content-Type', 'application/json')
      .send('{ invalid');

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ title: 'Bad Request', status: 400 });
  });

  it('returns 500 without leaking the message for unexpected errors', async () => {
    const response = await request(appThrowing(new Error('connection refused to db:5432'))).post('/boom');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      instance: '/boom',
    });
  });
});
