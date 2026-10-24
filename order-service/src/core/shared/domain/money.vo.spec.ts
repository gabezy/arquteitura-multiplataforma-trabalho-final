import { ValidationError } from './domain.error';
import { Money } from './money.vo';

describe('Money', () => {
  describe('fromReais', () => {
    it.each([
      [0, 0],
      [0.01, 1],
      [189.9, 18990],
      [4500, 450000],
      [18500.0, 1850000],
    ])('keeps %p reais as %p cents', (reais, cents) => {
      expect(Money.fromReais(reais).cents).toBe(cents);
    });

    it.each([1.234, 1.005, -0.01, -1, NaN, Infinity, 1e-7, 1e21])('rejects %p', reais => {
      expect(() => Money.fromReais(reais)).toThrow(ValidationError);
    });
  });

  it('multiplies and adds without float drift', () => {
    expect(Money.fromReais(0.1).times(3).toReais()).toBe(0.3);
    expect(Money.fromReais(189.9).plus(Money.fromReais(18500)).toReais()).toBe(18689.9);
  });

  it('starts a sum at zero', () => {
    expect(Money.zero().plus(Money.fromReais(0.01)).cents).toBe(1);
  });

  it('is equal to another amount with the same cents', () => {
    expect(Money.fromReais(4500).equals(Money.fromReais(4500.0))).toBe(true);
    expect(Money.fromReais(4500).equals(Money.fromReais(4500.01))).toBe(false);
  });
});
