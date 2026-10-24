import pino from 'pino';
import request from 'supertest';
import { createApp } from '../app';
import { ListingController } from '../listing/listing.controller';

interface LogLine {
  level: number;
  msg: string;
  err?: { message: string };
}

describe('GET /health', () => {
  const lines: LogLine[] = [];
  const logger = pino({ level: 'info' }, { write: (line: string) => lines.push(JSON.parse(line)) });
  const checkDatabase = jest.fn<Promise<void>, []>();
  const listingController = new ListingController({ find: jest.fn(), findById: jest.fn() });
  const app = createApp({ logger, checkDatabase, listingController });

  beforeEach(() => {
    lines.length = 0;
    checkDatabase.mockReset();
  });

  it('answers 200 UP when the database answers', async () => {
    checkDatabase.mockResolvedValue();

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'UP' });
    expect(lines).toEqual([]);
  });

  it('answers 503 DOWN and logs a warning when the database check fails', async () => {
    checkDatabase.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:5436'));

    const response = await request(app).get('/health');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'DOWN' });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 40, err: { message: 'connect ECONNREFUSED 127.0.0.1:5436' } });
  });

  it('answers UP again once the database is back', async () => {
    checkDatabase.mockRejectedValueOnce(new Error('connection lost')).mockResolvedValueOnce();

    expect((await request(app).get('/health')).status).toBe(503);
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'UP' });
  });
});
