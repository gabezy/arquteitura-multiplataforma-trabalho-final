import { Money } from './money.vo';
import { InvalidOrderError } from './order.errors';

describe('Money', () => {
  describe('ofAmount', () => {
    it.each([
      [15000, 1_500_000],
      [16.5, 1650],
      [19.99, 1999],
      [4.35, 435],
      [0.01, 1],
      [0, 0],
    ])('reads %p reais as %p cents', (amount, cents) => {
      expect(Money.ofAmount(amount).value).toBe(cents);
    });

    it.each([1.005, 10.001, 0.1 + 0.2, 4500.123])('rejects %p, which has more than two decimals, instead of rounding it', amount => {
      expect(() => Money.ofAmount(amount)).toThrow(InvalidOrderError);
    });

    it.each([-0.01, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('rejects %p', amount => {
      expect(() => Money.ofAmount(amount)).toThrow(InvalidOrderError);
    });

    it('rejects what is not a number', () => {
      expect(() => Money.ofAmount('10' as unknown as number)).toThrow(InvalidOrderError);
      expect(() => Money.ofAmount(null as unknown as number)).toThrow(InvalidOrderError);
    });

    it('rejects an amount too large to be kept exactly in cents', () => {
      expect(() => Money.ofAmount(1e300)).toThrow(InvalidOrderError);
    });
  });

  describe('ofCents', () => {
    it.each([-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('rejects %p', cents => {
      expect(() => Money.ofCents(cents)).toThrow(InvalidOrderError);
    });

    it('accepts zero and the largest safe amount', () => {
      expect(Money.ofCents(0).value).toBe(0);
      expect(Money.ofCents(Number.MAX_SAFE_INTEGER).value).toBe(Number.MAX_SAFE_INTEGER);
    });
  });

  describe('amount', () => {
    it.each([
      [1_500_000, '15000'],
      [1650, '16.5'],
      [1999, '19.99'],
      [1, '0.01'],
      [10_000_000_000_000, '100000000000'],
    ])('writes %p cents in JSON as %s', (cents, json) => {
      expect(JSON.stringify(Money.ofCents(cents).amount)).toBe(json);
    });
  });

  describe('arithmetic', () => {
    it('adds and multiplies in cents', () => {
      expect(Money.ofCents(1999).times(3).plus(Money.ofCents(3)).value).toBe(6000);
    });

    it('rejects a result that is no longer exact', () => {
      expect(() => Money.ofCents(Number.MAX_SAFE_INTEGER).plus(Money.ofCents(1))).toThrow(InvalidOrderError);
      expect(() => Money.ofCents(Number.MAX_SAFE_INTEGER).times(2)).toThrow(InvalidOrderError);
    });

    it('compares amounts', () => {
      const small = Money.ofCents(1);
      const large = Money.ofCents(2);

      expect(small.isLessThan(large)).toBe(true);
      expect(large.isLessThan(small)).toBe(false);
      expect(large.isGreaterThan(small)).toBe(true);
      expect(small.isGreaterThan(small)).toBe(false);
      expect(small.equals(Money.ofCents(1))).toBe(true);
      expect(small.equals(large)).toBe(false);
      expect(small.equals(undefined)).toBe(false);
    });
  });
});
