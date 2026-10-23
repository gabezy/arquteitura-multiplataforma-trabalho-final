import express, { Express } from 'express';
import pino from 'pino';
import request from 'supertest';
import { errorHandler } from './error-handler';
import { ConflictError, NotFoundError, ValidationError } from '../../core/shared/domain/domain.error';

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
    [new ValidationError('Quantity must be positive.'), 422, 'Unprocessable Entity'],
    [new NotFoundError('Order not found.'), 404, 'Not Found'],
    [new ConflictError('Order already cancelled.'), 409, 'Conflict'],
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

  it('keeps the status of a 4xx Express error, such as a malformed JSON body', async () => {
    const response = await request(appThrowing(new Error('unreachable')))
      .post('/boom')
      .set('Content-Type', 'application/json')
      .send('{ invalid');

    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body).toMatchObject({ type: 'about:blank', title: 'Bad Request', status: 400, instance: '/boom' });
  });

  it('returns 500 without leaking the message for unexpected errors', async () => {
    const response = await request(appThrowing(new Error('connection refused to order-db:5432'))).post('/boom');

    expect(response.status).toBe(500);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      instance: '/boom',
    });
  });
});
