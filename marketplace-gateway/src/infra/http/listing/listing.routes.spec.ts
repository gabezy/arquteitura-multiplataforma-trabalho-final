import pino from 'pino';
import request from 'supertest';
import { ListingNotFoundError } from '../../../core/listing/model/listing.errors';
import { FindListingsPort, ListingView } from '../../../core/listing/port/in/find-listings.port';
import { createApp } from '../app';
import { ListingController } from './listing.controller';

const ID = '6f1c2b8e-0000-4000-8000-000000000001';

const view = (overrides: Partial<ListingView> = {}): ListingView => ({
  id: ID,
  sku: 'NB-001',
  marketplace: 'MERCADO_LIVRE',
  externalListingId: 'MLB8685273650',
  status: 'PUBLISHED',
  price: 4500.5,
  stock: 2,
  failureReason: null,
  updatedAt: new Date('2026-10-28T13:05:02.123Z'),
  ...overrides,
});

describe('the listings API', () => {
  const findListingsPort: jest.Mocked<FindListingsPort> = { find: jest.fn(), findById: jest.fn() };
  const app = createApp({
    logger: pino({ level: 'silent' }),
    checkDatabase: async () => undefined,
    listingController: new ListingController(findListingsPort),
  });

  beforeEach(() => {
    jest.resetAllMocks();
    findListingsPort.find.mockResolvedValue({ listings: [], limit: 20, offset: 0 });
  });

  describe('GET /listings', () => {
    it('answers the listings with the limit and the offset, and each listing with exactly the fields of the contract', async () => {
      findListingsPort.find.mockResolvedValue({
        listings: [view(), view({ id: '6f1c2b8e-0000-4000-8000-000000000002', marketplace: 'SHOPEE', status: 'FAILED', externalListingId: null, failureReason: 'HTTP 503', stock: 0 })],
        limit: 20,
        offset: 0,
      });

      const response = await request(app).get('/listings');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.body).toEqual({
        listings: [
          {
            id: ID,
            sku: 'NB-001',
            marketplace: 'MERCADO_LIVRE',
            externalListingId: 'MLB8685273650',
            status: 'PUBLISHED',
            price: 4500.5,
            stock: 2,
            failureReason: null,
            updatedAt: '2026-10-28T13:05:02.123Z',
          },
          {
            id: '6f1c2b8e-0000-4000-8000-000000000002',
            sku: 'NB-001',
            marketplace: 'SHOPEE',
            externalListingId: null,
            status: 'FAILED',
            price: 4500.5,
            stock: 0,
            failureReason: 'HTTP 503',
            updatedAt: '2026-10-28T13:05:02.123Z',
          },
        ],
        limit: 20,
        offset: 0,
      });
      expect(Object.keys(response.body.listings[0])).toEqual([
        'id', 'sku', 'marketplace', 'externalListingId', 'status', 'price', 'stock', 'failureReason', 'updatedAt',
      ]);
    });

    it('asks for 20 listings from the start when no limit or offset is given', async () => {
      await request(app).get('/listings');

      expect(findListingsPort.find).toHaveBeenCalledWith({ limit: 20, offset: 0 });
    });

    it('passes the filters, the limit and the offset on', async () => {
      findListingsPort.find.mockResolvedValue({ listings: [], limit: 5, offset: 10 });

      const response = await request(app).get('/listings?sku=nb-001&marketplace=SHOPEE&status=FAILED&limit=5&offset=10');

      expect(findListingsPort.find).toHaveBeenCalledWith({ sku: 'nb-001', marketplace: 'SHOPEE', status: 'FAILED', limit: 5, offset: 10 });
      expect(response.body).toEqual({ listings: [], limit: 5, offset: 10 });
    });

    it('takes a filter that comes empty as no filter at all', async () => {
      await request(app).get('/listings?sku=&marketplace=&status=&limit=&offset=');

      expect(findListingsPort.find).toHaveBeenCalledWith({ limit: 20, offset: 0 });
    });

    it.each([['1'], ['100']])('accepts a limit of %s', async limit => {
      await expect(request(app).get(`/listings?limit=${limit}`)).resolves.toMatchObject({ status: 200 });
    });

    it.each([
      ['a limit of 0', 'limit=0', 'limit'],
      ['a limit of 101', 'limit=101', 'limit'],
      ['a negative limit', 'limit=-5', 'limit'],
      ['a limit that is not a number', 'limit=abc', 'limit'],
      ['a limit that is not a whole number', 'limit=1.5', 'limit'],
      ['a limit in scientific notation', 'limit=1e2', 'limit'],
      ['a limit that is blank', 'limit=%20', 'limit'],
      ['a negative offset', 'offset=-1', 'offset'],
      ['an offset that is not a number', 'offset=abc', 'offset'],
      ['a marketplace that does not exist', 'marketplace=EBAY', 'marketplace'],
      ['a marketplace in lower case', 'marketplace=shopee', 'marketplace'],
      ['a status that does not exist', 'status=DONE', 'status'],
      ['a filter given twice', 'sku=A&sku=B', 'sku'],
    ])('answers 422 for %s, without calling the port', async (_case, query, field) => {
      const response = await request(app).get(`/listings?${query}`);

      expect(response.status).toBe(422);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.body).toMatchObject({ type: 'about:blank', title: 'Unprocessable Entity', status: 422, detail: 'Request validation failed.' });
      expect(response.body.errors.map((issue: { path: string }) => issue.path)).toContain(field);
      expect(findListingsPort.find).not.toHaveBeenCalled();
    });
  });

  describe('GET /listings/{id}', () => {
    it('answers the listing', async () => {
      findListingsPort.findById.mockResolvedValue(view());

      const response = await request(app).get(`/listings/${ID}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: ID,
        sku: 'NB-001',
        marketplace: 'MERCADO_LIVRE',
        externalListingId: 'MLB8685273650',
        status: 'PUBLISHED',
        price: 4500.5,
        stock: 2,
        failureReason: null,
        updatedAt: '2026-10-28T13:05:02.123Z',
      });
      expect(findListingsPort.findById).toHaveBeenCalledWith(ID);
    });

    it('answers 404 when there is no listing with that id', async () => {
      findListingsPort.findById.mockRejectedValue(new ListingNotFoundError(ID));

      const response = await request(app).get(`/listings/${ID}`);

      expect(response.status).toBe(404);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.body).toMatchObject({ type: 'about:blank', title: 'Not Found', status: 404, detail: `Listing ${ID} not found.`, instance: `/listings/${ID}` });
    });

    it('answers 422 when the id is not a UUID, without calling the port', async () => {
      const response = await request(app).get('/listings/42');

      expect(response.status).toBe(422);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.body.errors.map((issue: { path: string }) => issue.path)).toEqual(['id']);
      expect(findListingsPort.findById).not.toHaveBeenCalled();
    });

    it('answers 400 when the path has a % that starts no escape sequence', async () => {
      const response = await request(app).get('/listings/%E0%A4%A');

      expect(response.status).toBe(400);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.body).toMatchObject({ type: 'about:blank', title: 'Bad Request', status: 400, detail: 'The request URL is malformed.' });
      expect(findListingsPort.findById).not.toHaveBeenCalled();
    });
  });

  it('answers a failure it did not expect with 500, without the message', async () => {
    findListingsPort.find.mockRejectedValue(new Error('connection refused to marketplace-db:5432'));

    const response = await request(app).get('/listings');

    expect(response.status).toBe(500);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body).toEqual({ type: 'about:blank', title: 'Internal Server Error', status: 500, instance: '/listings' });
  });
});
