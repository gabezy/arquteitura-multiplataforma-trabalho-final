import { Marketplace } from './marketplace';

// What a MarketplacePort call can fail with. The facades tell the two apart: an unavailable
// marketplace may answer later, a rejection never changes by repeating the call.
export abstract class MarketplaceError extends Error {
    constructor(message: string, readonly marketplace: Marketplace, public attempts = 1) {
        super(message);
        this.name = new.target.name;
    }
}

// Timeout, connection error, 429 or 5xx.
export class MarketplaceUnavailableError extends MarketplaceError {
    constructor(message: string, marketplace: Marketplace, attempts = 1, readonly retryAfterMs?: number) {
        super(message, marketplace, attempts);
    }
}

// The marketplace answered and refused the call (4xx other than 429, or a business error).
export class MarketplaceRejectedError extends MarketplaceError {}

// The circuit breaker of the marketplace is open: the call was not even made.
export class CircuitOpenError extends MarketplaceUnavailableError {
    constructor(marketplace: Marketplace) {
        super(`Circuit open for ${marketplace}`, marketplace, 0);
    }
}
