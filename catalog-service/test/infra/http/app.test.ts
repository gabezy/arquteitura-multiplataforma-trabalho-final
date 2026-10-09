import request from 'supertest';
import pino from 'pino';
import { createApp } from '../../../src/infra/http/app';

describe('app', () => {
  const app = createApp(pino({ level: 'silent' }));

  it('GET /health returns UP', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'UP' });
  });

  it('returns 404 for unknown routes', async () => {
    const response = await request(app).get('/unknown');

    expect(response.status).toBe(404);
  });
});
