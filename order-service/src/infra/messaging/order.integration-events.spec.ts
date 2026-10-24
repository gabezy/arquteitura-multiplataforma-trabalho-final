import { OrderCancelled, OrderConfirmed, OrderPlaced } from '../../core/order/model/order.events';
import { DomainEvent } from '../../core/shared/domain/domain.event';
import { toOrderIntegrationEvent } from './order.integration-events';

const ORDER_ID = '6f1c2b8e-0000-4000-8000-000000000001';
const ITEMS = [
  { sku: 'IPHONE-15', quantity: 2, unitPriceCents: 450_050 },
  { sku: 'CASE-01', quantity: 3, unitPriceCents: 1999 },
];

class Unmapped extends DomainEvent {
  readonly eventName = 'Unmapped';

  constructor() {
    super(ORDER_ID);
  }
}

describe('toOrderIntegrationEvent', () => {
  it('maps OrderPlaced to order.order.placed.v1, with the unit prices in reais', () => {
    expect(toOrderIntegrationEvent(new OrderPlaced(ORDER_ID, 'MERCADO_LIVRE', 'ML-2000001', ITEMS))).toEqual({
      type: 'order.order.placed.v1',
      data: {
        orderId: ORDER_ID,
        marketplace: 'MERCADO_LIVRE',
        externalOrderId: 'ML-2000001',
        items: [
          { sku: 'IPHONE-15', quantity: 2, unitPrice: 4500.5 },
          { sku: 'CASE-01', quantity: 3, unitPrice: 19.99 },
        ],
      },
    });
  });

  it('maps OrderConfirmed to order.order.confirmed.v1, with the total in reais and the time in UTC', () => {
    const confirmedAt = new Date('2026-10-28T13:05:02Z');

    expect(toOrderIntegrationEvent(new OrderConfirmed(ORDER_ID, 'AMAZON', 'AMZ-1', ITEMS, 906_097, confirmedAt))).toEqual({
      type: 'order.order.confirmed.v1',
      data: {
        orderId: ORDER_ID,
        marketplace: 'AMAZON',
        externalOrderId: 'AMZ-1',
        items: [
          { sku: 'IPHONE-15', quantity: 2, unitPrice: 4500.5 },
          { sku: 'CASE-01', quantity: 3, unitPrice: 19.99 },
        ],
        total: 9060.97,
        confirmedAt: '2026-10-28T13:05:02.000Z',
      },
    });
  });

  it.each(['OUT_OF_STOCK', 'PAYMENT_FAILED', 'MARKETPLACE_CANCELLED'])(
    'maps OrderCancelled for %s to order.order.cancelled.v1, with the marketplace and the external order id',
    reason => {
      expect(toOrderIntegrationEvent(new OrderCancelled(ORDER_ID, reason, 'SHOPEE', 'SH-9'))).toEqual({
        type: 'order.order.cancelled.v1',
        data: { orderId: ORDER_ID, reason, marketplace: 'SHOPEE', externalOrderId: 'SH-9' },
      });
    },
  );

  it('writes money that the billing-service reads: numbers with at most two decimals, never float noise', () => {
    const prices = [1, 10, 15000, 4500.5, 19.99, 0.01, 1_000_000, 4.35, 8.2, 33.33];
    const items = prices.map((price, index) => ({ sku: `SKU-${index}`, quantity: 1, unitPriceCents: Math.round(price * 100) }));

    const { data } = toOrderIntegrationEvent(new OrderConfirmed(ORDER_ID, 'AMAZON', 'AMZ-1', items, 123_456_789, new Date()));

    const text = JSON.stringify(data);
    expect([...text.matchAll(/"unitPrice":([0-9.e+-]+)/g)].map(match => match[1])).toEqual(prices.map(String));
    expect(text).toContain('"total":1234567.89');
    for (const [, number] of text.matchAll(/"(?:unitPrice|total)":([0-9.e+-]+)/g)) {
      expect(number).toMatch(/^\d+(\.\d{1,2})?$/);
    }
  });

  it('keeps the data of the contract and nothing of the internal event', () => {
    const { data } = toOrderIntegrationEvent(new OrderPlaced(ORDER_ID, 'AMAZON', 'AMZ-1', ITEMS));

    expect(Object.keys(data).sort()).toEqual(['externalOrderId', 'items', 'marketplace', 'orderId']);
  });

  it('rejects an event that has no public contract', () => {
    expect(() => toOrderIntegrationEvent(new Unmapped())).toThrow('No integration event for Unmapped.');
  });
});
