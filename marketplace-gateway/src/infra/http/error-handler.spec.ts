import express, { Express } from 'express';
import pino from 'pino';
import request from 'supertest';
import { errorHandler } from './error-handler';
import { z } from 'zod';
import { ConflictError, NotFoundError, ValidationError } from '../../core/shared/domain/domain.error';
import { RequestValidationError } from './validate';

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
    [new ValidationError('Price must not be negative.'), 422, 'Unprocessable Entity'],
    [new NotFoundError('Listing not found.'), 404, 'Not Found'],
    [new ConflictError('Listing already published.'), 409, 'Conflict'],
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

  it('maps a request whose values break the contract to 422, listing each issue', async () => {
    const { error } = z.object({ limit: z.number() }).safeParse({ limit: 'x' });

    const response = await request(appThrowing(new RequestValidationError(error as z.ZodError))).post('/boom');

    expect(response.status).toBe(422);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body).toEqual({
      type: 'about:blank',
      title: 'Unprocessable Entity',
      status: 422,
      detail: 'Request validation failed.',
      instance: '/boom',
      errors: [{ path: 'limit', message: expect.any(String) }],
    });
  });

  it('maps a malformed URL to 400, without repeating it', async () => {
    const response = await request(appThrowing(new URIError("Failed to decode param '%E0%A4%A'"))).post('/boom');

    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body).toEqual({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: 'The request URL is malformed.',
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

  it('does not log the request body of a malformed JSON request', async () => {
    const lines: string[] = [];
    const logger = pino({ level: 'info' }, { write: (line: string) => lines.push(line) });
    const app = express();
    app.use(express.json());
    app.use(errorHandler(logger));

    await request(app)
      .post('/listings')
      .set('Content-Type', 'application/json')
      .send('{ "externalListingId": "MLB-SECRET-1", ');

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('MLB-SECRET-1');
    expect(JSON.parse(lines[0])).toMatchObject({
      level: 40,
      status: 400,
      errType: 'entity.parse.failed',
      method: 'POST',
      path: '/listings',
    });
  });

  it('returns 500 without leaking the message for unexpected errors', async () => {
    const response = await request(appThrowing(new Error('connection refused to marketplace-db:5432'))).post('/boom');

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
