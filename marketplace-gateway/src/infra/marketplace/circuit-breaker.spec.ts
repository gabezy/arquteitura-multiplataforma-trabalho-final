import { CircuitBreaker } from './circuit-breaker';

const THRESHOLD = 5;
const COOLDOWN_MS = 30_000;

describe('CircuitBreaker', () => {
  let nowMs: number;
  let breaker: CircuitBreaker;

  const fail = (times: number) => {
    for (let i = 0; i < times; i++) {
      breaker.allowCall();
      breaker.recordFailure();
    }
  };

  beforeEach(() => {
    nowMs = 1_000_000;
    breaker = new CircuitBreaker({ failureThreshold: THRESHOLD, cooldownMs: COOLDOWN_MS }, () => nowMs);
  });

  it('starts closed and lets calls through', () => {
    expect(breaker.state).toBe('CLOSED');
    expect(breaker.allowCall()).toBe(true);
  });

  it('stays closed one failure short of the threshold', () => {
    fail(THRESHOLD - 1);

    expect(breaker.state).toBe('CLOSED');
    expect(breaker.allowCall()).toBe(true);
  });

  it('opens at the threshold and refuses calls', () => {
    fail(THRESHOLD);

    expect(breaker.state).toBe('OPEN');
    expect(breaker.allowCall()).toBe(false);
  });

  it('counts failures in a row: a success in between starts the count again', () => {
    fail(THRESHOLD - 1);
    breaker.recordSuccess();
    fail(THRESHOLD - 1);

    expect(breaker.state).toBe('CLOSED');
  });

  it('keeps refusing until the cooldown is over', () => {
    fail(THRESHOLD);

    nowMs += COOLDOWN_MS - 1;

    expect(breaker.allowCall()).toBe(false);
    expect(breaker.state).toBe('OPEN');
  });

  it('lets exactly one call through once the cooldown is over', () => {
    fail(THRESHOLD);
    nowMs += COOLDOWN_MS;

    expect(breaker.allowCall()).toBe(true);
    expect(breaker.state).toBe('HALF_OPEN');
    expect(breaker.allowCall()).toBe(false);
  });

  it('closes when the call that went through works', () => {
    fail(THRESHOLD);
    nowMs += COOLDOWN_MS;
    breaker.allowCall();

    breaker.recordSuccess();

    expect(breaker.state).toBe('CLOSED');
    expect(breaker.allowCall()).toBe(true);
    expect(breaker.allowCall()).toBe(true);
  });

  it('opens again, with a new cooldown, when the call that went through fails', () => {
    fail(THRESHOLD);
    nowMs += COOLDOWN_MS;
    breaker.allowCall();

    breaker.recordFailure();

    expect(breaker.state).toBe('OPEN');
    nowMs += COOLDOWN_MS - 1;
    expect(breaker.allowCall()).toBe(false);
    nowMs += 1;
    expect(breaker.allowCall()).toBe(true);
  });
});
