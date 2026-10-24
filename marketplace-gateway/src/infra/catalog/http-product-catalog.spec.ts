import http, { Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { DomainError } from '../../core/shared/domain/domain.error';
import {
    ProductNotApprovedError,
    ProductNotFoundError,
    ProductRequestRefusedError,
} from '../../core/listing/model/listing.errors';
import { CatalogUnavailableError, HttpProductCatalog } from './http-product-catalog';

// What GET /products/sku/:sku of the catalog-service answers.
const catalogProduct = (overrides: Record<string, unknown> = {}) => ({
  id: '0b8f2c1e-6a4d-4d1e-9a51-3f0f1b2c7d10',
  sku: 'NB-001',
  name: 'Notebook',
  description: 'Notebook 16GB RAM',
  price: 4500,
  stock: 2,
  analysisStatus: 'APPROVED',
  ...overrides,
});

describe('HttpProductCatalog', () => {
  let server: Server;
  let baseUrl: string;
  let requestedUrls: string[];
  let answer: (res: ServerResponse) => void;

  const catalog = (options: { timeoutMs?: number; baseUrl?: string } = {}) =>
    new HttpProductCatalog({ baseUrl: options.baseUrl ?? baseUrl, timeoutMs: options.timeoutMs ?? 2000 });

  const reply = (status: number, body?: string) => (res: ServerResponse) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(body);
  };

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      requestedUrls.push(req.url ?? '');
      answer(res);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });

  beforeEach(() => {
    requestedUrls = [];
    answer = reply(200, JSON.stringify(catalogProduct()));
  });

  it('reads the product from /products/sku/:sku and gives the data the listing needs', async () => {
    await expect(catalog().findBySku('NB-001')).resolves.toEqual({
      sku: 'NB-001',
      name: 'Notebook',
      description: 'Notebook 16GB RAM',
      price: 4500,
      stock: 2,
    });
    expect(requestedUrls).toEqual(['/products/sku/NB-001']);
  });

  it('works with a base URL that ends in a slash, and escapes the SKU', async () => {
    await catalog({ baseUrl: `${baseUrl}/` }).findBySku('a b/c');

    expect(requestedUrls).toEqual(['/products/sku/a%20b%2Fc']);
  });

  it('fails with ProductNotFoundError when the catalog has no such product', async () => {
    answer = reply(404, '{"title":"Not Found"}');

    const failure = await catalog().findBySku('NB-404').catch((err: Error) => err);

    expect(failure).toBeInstanceOf(ProductNotFoundError);
    expect(failure).toBeInstanceOf(DomainError);
    expect((failure as Error).message).toBe('Product NB-404 not found in the catalog.');
  });

  it.each(['PENDING', 'REJECTED'])('fails with ProductNotApprovedError when the analysis status is %s', async status => {
    answer = reply(200, JSON.stringify(catalogProduct({ analysisStatus: status })));

    const failure = await catalog().findBySku('NB-001').catch((err: Error) => err);

    expect(failure).toBeInstanceOf(ProductNotApprovedError);
    expect(failure).toBeInstanceOf(DomainError);
    expect((failure as Error).message).toBe(`Product NB-001 is not approved: its analysis status is ${status}.`);
  });

  it.each([400, 409, 422])('fails with a refusal, which is never worth repeating, when the catalog answers %i', async status => {
    answer = reply(status, '{}');

    const failure = await catalog().findBySku('NB-001').catch((err: Error) => err);

    expect(failure).toBeInstanceOf(ProductRequestRefusedError);
    expect(failure).toBeInstanceOf(DomainError);
    expect((failure as Error).message).toBe(`The catalog refused the request for product NB-001: HTTP ${status}.`);
  });

  it.each([408, 429, 500, 502, 503])('is unavailable, which is worth repeating, when the catalog answers %i', async status => {
    answer = reply(status, '{}');

    const failure = await catalog().findBySku('NB-001').catch((err: Error) => err);

    expect(failure).toBeInstanceOf(CatalogUnavailableError);
    expect(failure).not.toBeInstanceOf(DomainError);
    expect((failure as Error).message).toBe(`The catalog answered HTTP ${status}.`);
  });

  it('is unavailable when the catalog does not answer in time', async () => {
    answer = () => undefined;

    const failure = await catalog({ timeoutMs: 100 }).findBySku('NB-001').catch((err: Error) => err);

    expect(failure).toBeInstanceOf(CatalogUnavailableError);
    expect((failure as Error).message).toBe('The catalog did not answer within 100 ms');
  });

  it('is unavailable when the connection is refused', async () => {
    const probe = http.createServer();
    await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
    const { port } = probe.address() as AddressInfo;
    await new Promise(resolve => probe.close(resolve));

    const failure = await catalog({ baseUrl: `http://127.0.0.1:${port}` }).findBySku('NB-001').catch((err: Error) => err);

    expect(failure).toBeInstanceOf(CatalogUnavailableError);
    expect((failure as Error).message).toMatch(/^The catalog is unreachable: .*ECONNREFUSED/);
  });

  it.each([
    ['a body that is not JSON', '<html>maintenance</html>'],
    ['a product without a name', JSON.stringify({ ...catalogProduct(), name: undefined })],
    ['a price that is text', JSON.stringify(catalogProduct({ price: 'muito' }))],
    ['a stock that is not a whole number', JSON.stringify(catalogProduct({ stock: 1.5 }))],
  ])('is unavailable when the catalog answers %s', async (_case, body) => {
    answer = reply(200, body);

    await expect(catalog().findBySku('NB-001')).rejects.toBeInstanceOf(CatalogUnavailableError);
  });
});
