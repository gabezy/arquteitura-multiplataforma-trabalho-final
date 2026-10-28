export interface CircuitBreakerOptions {
    // Failures in a row that open the circuit.
    failureThreshold: number;
    // How long the circuit stays open before it lets one call through.
    cooldownMs: number;
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

// Closed: calls pass. After failureThreshold failures in a row it opens, and calls are refused
// for cooldownMs. Then it half-opens and lets one call through: success closes it, failure opens it again.
export class CircuitBreaker {

    private consecutiveFailures = 0;
    private openedAt = 0;
    private current: CircuitState = 'CLOSED';
    private probing = false;

    constructor(private readonly options: CircuitBreakerOptions, private readonly now: () => number = Date.now) {}

    get state(): CircuitState {
        return this.current;
    }

    // Asks to make a call. Answers false when the circuit refuses it.
    allowCall(): boolean {
        if (this.current === 'CLOSED') {
            return true;
        }

        if (this.current === 'OPEN' && this.now() - this.openedAt >= this.options.cooldownMs) {
            this.current = 'HALF_OPEN';
        }

        if (this.current === 'HALF_OPEN' && !this.probing) {
            this.probing = true;
            return true;
        }

        return false;
    }

    recordSuccess(): void {
        this.consecutiveFailures = 0;
        this.probing = false;
        this.current = 'CLOSED';
    }

    recordFailure(): void {
        this.probing = false;
        this.consecutiveFailures++;

        if (this.current === 'HALF_OPEN' || this.consecutiveFailures >= this.options.failureThreshold) {
            this.current = 'OPEN';
            this.openedAt = this.now();
        }
    }

}
