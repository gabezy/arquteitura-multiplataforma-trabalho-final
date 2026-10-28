import { Logger } from 'pino';
import { Marketplace } from '../../core/marketplace/model/marketplace';
import {
    CircuitOpenError,
    MarketplaceError,
    MarketplaceRejectedError,
    MarketplaceUnavailableError,
} from '../../core/marketplace/model/marketplace.errors';
import {
    CancelOrderRequest,
    CanonicalOrder,
    ListingDraft,
    MarketplacePort,
    PriceUpdate,
    PublishedListing,
    StockUpdate,
} from '../../core/marketplace/port/out/marketplace.port';
import { CircuitBreaker, CircuitBreakerOptions } from './circuit-breaker';

export interface ResilienceOptions {
    // Calls in total, the first one included.
    maxAttempts: number;
    // The wait before attempt n+1 is random between 0 and min(maxDelayMs, baseDelayMs * 2^(n-1)) (full jitter).
    baseDelayMs: number;
    maxDelayMs: number;
    // The longest Retry-After the gateway waits for.
    maxRetryAfterMs: number;
    breaker: CircuitBreakerOptions;
}

export interface ResilienceDependencies {
    logger: Logger;
    sleep?: (ms: number) => Promise<void>;
    random?: () => number;
    now?: () => number;
}

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

// Decorates a MarketplacePort with the policy of ADR-0009: retry with exponential backoff and jitter
// on transient failures, and a circuit breaker for the marketplace. A rejection is never retried.
export class ResilientMarketplace implements MarketplacePort {

    private readonly breaker: CircuitBreaker;
    private readonly sleep: (ms: number) => Promise<void>;
    private readonly random: () => number;

    constructor(
        private readonly inner: MarketplacePort,
        private readonly options: ResilienceOptions,
        private readonly dependencies: ResilienceDependencies,
    ) {
        this.breaker = new CircuitBreaker(options.breaker, dependencies.now);
        this.sleep = dependencies.sleep ?? wait;
        this.random = dependencies.random ?? Math.random;
    }

    get marketplace(): Marketplace {
        return this.inner.marketplace;
    }

    publishListing(draft: ListingDraft): Promise<PublishedListing> {
        return this.execute('publishListing', () => this.inner.publishListing(draft));
    }

    updateStock(update: StockUpdate): Promise<void> {
        return this.execute('updateStock', () => this.inner.updateStock(update));
    }

    updatePrice(update: PriceUpdate): Promise<void> {
        return this.execute('updatePrice', () => this.inner.updatePrice(update));
    }

    fetchNewOrders(since: Date): Promise<CanonicalOrder[]> {
        return this.execute('fetchNewOrders', () => this.inner.fetchNewOrders(since));
    }

    cancelOrder(request: CancelOrderRequest): Promise<void> {
        return this.execute('cancelOrder', () => this.inner.cancelOrder(request));
    }

    private async execute<T>(operation: string, call: () => Promise<T>): Promise<T> {
        for (let attempt = 1; ; attempt++) {
            if (!this.breaker.allowCall()) {
                throw new CircuitOpenError(this.marketplace);
            }

            try {
                const result = await call();
                this.breaker.recordSuccess();
                return result;
            } catch (err) {
                if (err instanceof MarketplaceRejectedError) {
                    // The marketplace answered, so it is up: the call is wrong, not the marketplace.
                    this.breaker.recordSuccess();
                    err.attempts = attempt;
                    throw err;
                }

                this.breaker.recordFailure();

                if (!(err instanceof MarketplaceUnavailableError)) {
                    throw err;
                }

                err.attempts = attempt;
                if (attempt >= this.options.maxAttempts || this.breaker.state === 'OPEN') {
                    throw err;
                }

                const delayMs = this.delayBefore(attempt, err);
                this.dependencies.logger.warn(
                    { marketplace: this.marketplace, operation, attempt, delayMs, err },
                    'Marketplace call failed, trying again',
                );
                await this.sleep(delayMs);
            }
        }
    }

    private delayBefore(attempt: number, err: MarketplaceError): number {
        const { baseDelayMs, maxDelayMs, maxRetryAfterMs } = this.options;
        const backoffMs = this.random() * Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
        const retryAfterMs = err instanceof MarketplaceUnavailableError ? err.retryAfterMs : undefined;

        return retryAfterMs === undefined ? backoffMs : Math.min(maxRetryAfterMs, Math.max(backoffMs, retryAfterMs));
    }

}
