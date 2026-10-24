import { CancellationReason } from './cancellation-reason.vo';
import { Marketplace } from './marketplace.vo';
import { OrderStatus } from './order-status.vo';
import { InvalidOrderError } from './order.errors';

describe('Marketplace', () => {
  it.each(['AMAZON', 'MERCADO_LIVRE', 'SHOPEE'])('knows %s', value => {
    expect(Marketplace.of(value).value).toBe(value);
    expect(Marketplace.of(value).equals(Marketplace.of(value))).toBe(true);
  });

  it('lists the three marketplaces of the platform', () => {
    expect(Marketplace.ALL.map(marketplace => marketplace.value)).toEqual(['AMAZON', 'MERCADO_LIVRE', 'SHOPEE']);
  });

  it.each(['', 'amazon', 'EBAY', ' AMAZON', 'Mercado Livre'])('rejects %j', value => {
    expect(() => Marketplace.of(value)).toThrow(InvalidOrderError);
  });

  it('does not echo a rejected value, so a huge one never reaches the reason of a dead letter', () => {
    const message = (() => {
      try {
        Marketplace.of('X'.repeat(5000));
      } catch (error) {
        return (error as Error).message;
      }
      return '';
    })();

    expect(message).toMatch(/^Marketplace must be one of/);
    expect(message.length).toBeLessThan(100);
  });

  it('is not equal to another marketplace or to nothing', () => {
    expect(Marketplace.AMAZON.equals(Marketplace.SHOPEE)).toBe(false);
    expect(Marketplace.AMAZON.equals(undefined)).toBe(false);
  });
});

describe('OrderStatus', () => {
  it.each(['RECEIVED', 'CONFIRMED', 'PAID', 'CANCELLED'])('knows %s', value => {
    expect(OrderStatus.of(value)).toBe(OrderStatus[value as 'RECEIVED']);
  });

  it.each(['', 'received', 'SHIPPED'])('rejects %j', value => {
    expect(() => OrderStatus.of(value)).toThrow(InvalidOrderError);
  });

  it('is not equal to another status or to nothing', () => {
    expect(OrderStatus.PAID.equals(OrderStatus.CONFIRMED)).toBe(false);
    expect(OrderStatus.PAID.equals(undefined)).toBe(false);
  });
});

describe('CancellationReason', () => {
  it.each(['OUT_OF_STOCK', 'PAYMENT_FAILED', 'MARKETPLACE_CANCELLED'])('knows %s', value => {
    expect(CancellationReason.of(value).value).toBe(value);
  });

  it.each(['', 'out_of_stock', 'CHANGED_MIND'])('rejects %j', value => {
    expect(() => CancellationReason.of(value)).toThrow(InvalidOrderError);
  });

  it('is not equal to another reason or to nothing', () => {
    expect(CancellationReason.OUT_OF_STOCK.equals(CancellationReason.PAYMENT_FAILED)).toBe(false);
    expect(CancellationReason.OUT_OF_STOCK.equals(undefined)).toBe(false);
  });
});
