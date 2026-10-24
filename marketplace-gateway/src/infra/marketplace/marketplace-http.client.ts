import { Marketplace } from '../../core/marketplace/model/marketplace';
import { MarketplaceRejectedError, MarketplaceUnavailableError } from '../../core/marketplace/model/marketplace.errors';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH';

export interface HttpRequest {
    method: HttpMethod;
    path: string;
    query?: Record<string, string | number | undefined>;
    body?: unknown;
    headers?: Record<string, string>;
}

export interface HttpResponse {
    status: number;
    body: unknown;
}

// What an adapter needs from the network. The adapters depend on this, so their translation
// is tested without HTTP.
export interface MarketplaceHttp {
    send(request: HttpRequest): Promise<HttpResponse>;
}

export interface MarketplaceHttpClientOptions {
    baseUrl: string;
    timeoutMs: number;
    // Pulls the reason out of the error body of this marketplace, for the rejection message.
    describeError?: (body: unknown) => string | undefined;
}

const SERVER_ERROR = 500;
const TOO_MANY_REQUESTS = 429;
const MAX_DETAIL_LENGTH = 200;

// Talks JSON to a marketplace and turns every failure into one of the two errors of the port:
// unavailable (timeout, no connection, 429, 5xx) or rejected (any other 4xx).
export class MarketplaceHttpClient implements MarketplaceHttp {

    constructor(
        private readonly marketplace: Marketplace,
        private readonly options: MarketplaceHttpClientOptions,
        private readonly fetchFn: typeof fetch = fetch,
    ) {}

    async send(request: HttpRequest): Promise<HttpResponse> {
        const { response, text } = await this.exchange(request);
        const body = parseJson(text);

        if (response.ok) {
            if (text !== '' && body === undefined) {
                throw new MarketplaceUnavailableError(`${this.marketplace} answered ${response.status} with a body that is not JSON`, this.marketplace);
            }
            return { status: response.status, body };
        }

        throw this.failureOf(response, body, text);
    }

    private async exchange(request: HttpRequest): Promise<{ response: Response; text: string }> {
        try {
            const response = await this.fetchFn(this.urlOf(request), {
                method: request.method,
                headers: { accept: 'application/json', ...(request.body === undefined ? {} : { 'content-type': 'application/json' }), ...request.headers },
                body: request.body === undefined ? undefined : JSON.stringify(request.body),
                signal: AbortSignal.timeout(this.options.timeoutMs),
            });
            return { response, text: await response.text() };
        } catch (err) {
            throw this.unavailableBecauseOf(err);
        }
    }

    private urlOf({ path, query = {} }: HttpRequest): string {
        const url = new URL(`${this.options.baseUrl.replace(/\/+$/, '')}${path}`);

        for (const [name, value] of Object.entries(query)) {
            if (value !== undefined) {
                url.searchParams.set(name, String(value));
            }
        }

        return url.toString();
    }

    private unavailableBecauseOf(err: unknown): MarketplaceUnavailableError {
        const { name, message, cause } = err as { name?: string; message?: string; cause?: { message?: string } };

        if (name === 'TimeoutError') {
            return new MarketplaceUnavailableError(`${this.marketplace} did not answer within ${this.options.timeoutMs} ms`, this.marketplace);
        }

        return new MarketplaceUnavailableError(`${this.marketplace} is unreachable: ${cause?.message ?? message}`, this.marketplace);
    }

    private failureOf(response: Response, body: unknown, text: string): MarketplaceUnavailableError | MarketplaceRejectedError {
        if (response.status === TOO_MANY_REQUESTS) {
            return new MarketplaceUnavailableError(`HTTP ${response.status}`, this.marketplace, 1, retryAfterMsOf(response));
        }

        if (response.status >= SERVER_ERROR) {
            return new MarketplaceUnavailableError(`HTTP ${response.status}`, this.marketplace);
        }

        const detail = this.options.describeError?.(body) ?? text.slice(0, MAX_DETAIL_LENGTH);
        return new MarketplaceRejectedError(detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}`, this.marketplace);
    }

}

function parseJson(text: string): unknown {
    if (text === '') {
        return undefined;
    }

    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

// Retry-After is a number of seconds or an HTTP date.
function retryAfterMsOf(response: Response): number | undefined {
    const header = response.headers.get('retry-after');
    if (header === null || header.trim() === '') {
        return undefined;
    }

    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
        return seconds * 1000;
    }

    const date = Date.parse(header);
    return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}
