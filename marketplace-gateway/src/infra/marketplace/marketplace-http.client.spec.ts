import http, { IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { MarketplaceRejectedError, MarketplaceUnavailableError } from '../../core/marketplace/model/marketplace.errors';
import { MarketplaceHttpClient } from './marketplace-http.client';

interface ReceivedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

describe('MarketplaceHttpClient', () => {
  let server: Server;
  let baseUrl: string;
  let received: ReceivedRequest[];
  let answer: (res: ServerResponse) => void;

  const client = (options: { timeoutMs?: number; baseUrl?: string; describeError?: (body: unknown) => string | undefined } = {}) =>
    new MarketplaceHttpClient('SHOPEE', { baseUrl: options.baseUrl ?? baseUrl, timeoutMs: options.timeoutMs ?? 2000, describeError: options.describeError });

  // A port nobody listens on: fetch refuses some low ports on its own ("bad port"), so port 1 will not do.
  const freePort = async (): Promise<number> => {
    const probe = http.createServer();
    await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
    const { port } = probe.address() as AddressInfo;
    await new Promise(resolve => probe.close(resolve));
    return port;
  };

  const reply = (status: number, body?: string, headers: Record<string, string> = {}) => (res: ServerResponse) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(body);
  };

  beforeAll(async () => {
    server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        received.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks).toString() });
        answer(res);
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/shopee`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });

  beforeEach(() => {
    received = [];
    answer = reply(200, '{}');
  });

  describe('the request', () => {
    it('goes to the path under the base URL, with the query, skipping the parameters without value', async () => {
      await client().send({ method: 'GET', path: '/api/v2/order/get_order_list', query: { shop_id: '1001', page_size: 100, cursor: undefined } });

      expect(received[0]).toMatchObject({ method: 'GET', url: '/shopee/api/v2/order/get_order_list?shop_id=1001&page_size=100' });
    });

    it('works with a base URL that ends in a slash', async () => {
      await client({ baseUrl: `${baseUrl}/` }).send({ method: 'GET', path: '/ping' });

      expect(received[0].url).toBe('/shopee/ping');
    });

    it('sends the body as JSON, and the extra headers', async () => {
      await client().send({ method: 'POST', path: '/x', body: { order_sn: 'SHP1' }, headers: { 'idempotency-key': 'abc' } });

      expect(received[0].headers).toMatchObject({ accept: 'application/json', 'content-type': 'application/json', 'idempotency-key': 'abc' });
      expect(JSON.parse(received[0].body)).toEqual({ order_sn: 'SHP1' });
    });

    it('sends no content type when there is no body', async () => {
      await client().send({ method: 'GET', path: '/x' });

      expect(received[0].headers['content-type']).toBeUndefined();
    });
  });

  describe('the answer', () => {
    it('is the status and the JSON body of a 2xx', async () => {
      answer = reply(201, '{"id":"MLB1"}');

      await expect(client().send({ method: 'POST', path: '/items' })).resolves.toEqual({ status: 201, body: { id: 'MLB1' } });
    });

    it('has no body when a 2xx comes empty', async () => {
      answer = reply(204);

      await expect(client().send({ method: 'POST', path: '/x' })).resolves.toEqual({ status: 204, body: undefined });
    });

    it('is a failure of the marketplace when a 2xx does not carry JSON', async () => {
      answer = reply(200, '<html>maintenance</html>');

      await expect(client().send({ method: 'GET', path: '/x' })).rejects.toThrow(MarketplaceUnavailableError);
    });
  });

  describe('a marketplace that is unavailable', () => {
    it.each([500, 502, 503, 504])('is what a %i means', async status => {
      answer = reply(status, '{"error":"error_server"}');

      const failure = await client().send({ method: 'GET', path: '/x' }).catch((err: MarketplaceUnavailableError) => err);

      expect(failure).toBeInstanceOf(MarketplaceUnavailableError);
      expect(failure).toMatchObject({ message: `HTTP ${status}`, marketplace: 'SHOPEE', retryAfterMs: undefined });
    });

    it('is what a 429 means, with the Retry-After in seconds', async () => {
      answer = reply(429, '{}', { 'retry-after': '2' });

      const failure = await client().send({ method: 'GET', path: '/x' }).catch((err: MarketplaceUnavailableError) => err);

      expect(failure).toBeInstanceOf(MarketplaceUnavailableError);
      expect(failure).toMatchObject({ message: 'HTTP 429', retryAfterMs: 2000 });
    });

    it('reads a Retry-After that is an HTTP date', async () => {
      answer = reply(429, '{}', { 'retry-after': new Date(Date.now() + 10_000).toUTCString() });

      const failure = await client().send({ method: 'GET', path: '/x' }).catch((err: MarketplaceUnavailableError) => err);

      expect((failure as MarketplaceUnavailableError).retryAfterMs).toBeGreaterThan(7000);
      expect((failure as MarketplaceUnavailableError).retryAfterMs).toBeLessThanOrEqual(10_000);
    });

    it('has no Retry-After when the 429 brings none, or one that makes no sense', async () => {
      answer = reply(429, '{}', { 'retry-after': 'soon' });

      const failure = await client().send({ method: 'GET', path: '/x' }).catch((err: MarketplaceUnavailableError) => err);

      expect((failure as MarketplaceUnavailableError).retryAfterMs).toBeUndefined();
    });

    it('is what a timeout means', async () => {
      answer = () => undefined;

      const failure = await client({ timeoutMs: 100 }).send({ method: 'GET', path: '/x' }).catch((err: MarketplaceUnavailableError) => err);

      expect(failure).toBeInstanceOf(MarketplaceUnavailableError);
      expect(failure).toMatchObject({ message: 'SHOPEE did not answer within 100 ms' });
    });

    it('is what a refused connection means', async () => {
      const closedPort = await freePort();

      const failure = await client({ baseUrl: `http://127.0.0.1:${closedPort}/shopee` }).send({ method: 'GET', path: '/x' }).catch((err: MarketplaceUnavailableError) => err);

      expect(failure).toBeInstanceOf(MarketplaceUnavailableError);
      expect((failure as Error).message).toMatch(/^SHOPEE is unreachable: .*ECONNREFUSED/);
    });
  });

  describe('a marketplace that refuses the call', () => {
    it.each([400, 404, 409, 422])('is what a %i means', async status => {
      answer = reply(status, '{"error":"invalid"}');

      const failure = await client().send({ method: 'GET', path: '/x' }).catch((err: MarketplaceRejectedError) => err);

      expect(failure).toBeInstanceOf(MarketplaceRejectedError);
      expect(failure).toMatchObject({ message: `HTTP ${status}: {"error":"invalid"}`, marketplace: 'SHOPEE' });
    });

    it('carries the reason the marketplace gave, in its own format', async () => {
      answer = reply(400, '{"errors":[{"message":"list_price must be greater than zero"}]}');
      const describeError = (body: unknown) => (body as { errors: { message: string }[] }).errors[0].message;

      const failure = await client({ describeError }).send({ method: 'GET', path: '/x' }).catch((err: MarketplaceRejectedError) => err);

      expect((failure as Error).message).toBe('HTTP 400: list_price must be greater than zero');
    });

    it('keeps the status only when the answer has no body', async () => {
      answer = reply(404);

      await expect(client().send({ method: 'GET', path: '/x' })).rejects.toThrow(new MarketplaceRejectedError('HTTP 404', 'SHOPEE'));
    });

    it('cuts a long body at 200 characters', async () => {
      answer = reply(400, 'x'.repeat(500));

      const failure = await client().send({ method: 'GET', path: '/x' }).catch((err: Error) => err);

      expect((failure as Error).message).toBe(`HTTP 400: ${'x'.repeat(200)}`);
    });
  });
});
