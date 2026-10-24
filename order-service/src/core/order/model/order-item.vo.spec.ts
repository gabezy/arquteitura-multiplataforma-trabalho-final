import { OrderItem } from './order-item.vo';
import { InvalidOrderError } from './order.errors';

const item = (overrides: Partial<{ sku: string; quantity: number; unitPrice: number }> = {}) =>
  OrderItem.of({ sku: 'IPHONE-15', quantity: 1, unitPrice: 15000, ...overrides });

describe('OrderItem', () => {
  it('keeps the SKU trimmed, the quantity and the unit price in cents', () => {
    const line = item({ sku: '  IPHONE-15 ', quantity: 3, unitPrice: 4500.5 });

    expect(line.sku).toBe('IPHONE-15');
    expect(line.quantity).toBe(3);
    expect(line.unitPrice.value).toBe(450_050);
    expect(line.value).toEqual({ sku: 'IPHONE-15', quantity: 3, unitPriceCents: 450_050 });
  });

  it('keeps the case of the SKU as received', () => {
    expect(item({ sku: 'nb-001' }).sku).toBe('nb-001');
  });

  it('totals the quantity times the unit price', () => {
    expect(item({ quantity: 7, unitPrice: 19.99 }).total.value).toBe(13_993);
  });

  describe('quantity', () => {
    it.each([1, 2, 10_000])('accepts %p', quantity => {
      expect(item({ quantity }).quantity).toBe(quantity);
    });

    it.each([0, -1, 10_001, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects %p', quantity => {
      expect(() => item({ quantity })).toThrow(InvalidOrderError);
    });

    it('rejects what is not a number', () => {
      expect(() => item({ quantity: '2' as unknown as number })).toThrow(InvalidOrderError);
    });
  });

  describe('unit price', () => {
    it.each([0.01, 1, 4500, 1_000_000])('accepts %p', unitPrice => {
      expect(item({ unitPrice }).unitPrice.amount).toBe(unitPrice);
    });

    it.each([0, 0.009, 1_000_000.01, 2_000_000, -5])('rejects %p, outside 0.01 to 1000000.00', unitPrice => {
      expect(() => item({ unitPrice })).toThrow(InvalidOrderError);
    });

    it.each([1.005, 4500.999, 0.1 + 0.2])('rejects %p, which has more than two decimals', unitPrice => {
      expect(() => item({ unitPrice })).toThrow(InvalidOrderError);
    });
  });

  describe('SKU', () => {
    it.each(['', '   ', '\t\n'])('rejects the blank SKU %j', sku => {
      expect(() => item({ sku })).toThrow(InvalidOrderError);
    });

    it('rejects what is not text', () => {
      expect(() => item({ sku: undefined as unknown as string })).toThrow(InvalidOrderError);
      expect(() => item({ sku: 42 as unknown as string })).toThrow(InvalidOrderError);
    });

    it('accepts 100 characters and rejects 101', () => {
      expect(item({ sku: 'A'.repeat(100) }).sku).toHaveLength(100);
      expect(() => item({ sku: 'A'.repeat(101) })).toThrow(InvalidOrderError);
    });
  });

  describe('restore', () => {
    it('rebuilds the line from what was stored', () => {
      const line = OrderItem.restore({ sku: 'IPHONE-15', quantity: 2, unitPriceCents: 1_500_000 });

      expect(line.equals(item({ quantity: 2 }))).toBe(true);
    });

    it('rejects a stored line that breaks the bounds', () => {
      expect(() => OrderItem.restore({ sku: 'IPHONE-15', quantity: 0, unitPriceCents: 100 })).toThrow(InvalidOrderError);
      expect(() => OrderItem.restore({ sku: 'IPHONE-15', quantity: 1, unitPriceCents: 0 })).toThrow(InvalidOrderError);
      expect(() => OrderItem.restore({ sku: 'IPHONE-15', quantity: 1, unitPriceCents: 1.5 })).toThrow(InvalidOrderError);
    });
  });

  it('is equal to a line with the same SKU, quantity and unit price', () => {
    expect(item().equals(item())).toBe(true);
    expect(item().equals(item({ sku: 'OTHER' }))).toBe(false);
    expect(item().equals(item({ quantity: 2 }))).toBe(false);
    expect(item().equals(item({ unitPrice: 14999.99 }))).toBe(false);
    expect(item().equals(undefined)).toBe(false);
  });
});
