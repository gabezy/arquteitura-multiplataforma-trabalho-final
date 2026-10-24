import { InvalidMarketplaceOrderError } from './marketplace-order.errors';
import { MarketplaceOrder, ReceiveMarketplaceOrderProps } from './marketplace-order.entity';
import { OrderReceived } from './order-received.event';
import { ValidationError } from '../../shared/domain/domain.error';

const ORDERED_AT = new Date('2026-10-28T13:05:00Z');

const props = (overrides: Partial<ReceiveMarketplaceOrderProps> = {}): ReceiveMarketplaceOrderProps => ({
  marketplace: 'MERCADO_LIVRE',
  externalOrderId: '2000001',
  items: [{ sku: 'NB-001', quantity: 1, unitPrice: 4500 }],
  total: 4500,
  orderedAt: ORDERED_AT,
  ...overrides,
});

describe('MarketplaceOrder', () => {
  describe('receive', () => {
    it('is identified by the marketplace and the id the marketplace gave it', () => {
      const order = MarketplaceOrder.receive(props());

      expect(order.id.value).toBe('MERCADO_LIVRE:2000001');
      expect(order.marketplace).toBe('MERCADO_LIVRE');
      expect(order.externalOrderId).toBe('2000001');
    });

    it('records one OrderReceived event keyed by the marketplace and the external id', () => {
      const order = MarketplaceOrder.receive(props());

      const [event, ...others] = order.pullDomainEvents();

      expect(others).toEqual([]);
      expect(event).toBeInstanceOf(OrderReceived);
      expect(event).toMatchObject({
        aggregateId: 'MERCADO_LIVRE:2000001',
        marketplace: 'MERCADO_LIVRE',
        externalOrderId: '2000001',
        items: [{ sku: 'NB-001', quantity: 1, unitPrice: 4500 }],
        total: 4500,
        orderedAt: ORDERED_AT,
      });
    });

    it('keeps its own copy of the items', () => {
      const items = [{ sku: 'NB-001', quantity: 1, unitPrice: 4500 }];
      const order = MarketplaceOrder.receive(props({ items }));

      items[0].quantity = 99;

      expect(order.items[0].quantity).toBe(1);
    });

    it('accepts an item that costs nothing', () => {
      expect(() => MarketplaceOrder.receive(props({ items: [{ sku: 'BRINDE-1', quantity: 1, unitPrice: 0 }], total: 0 }))).not.toThrow();
    });

    it.each([
      ['no items', { items: [] }, 'at least one item'],
      ['an item without SKU', { items: [{ sku: ' ', quantity: 1, unitPrice: 10 }] }, 'needs a SKU'],
      ['a zero quantity', { items: [{ sku: 'NB-001', quantity: 0, unitPrice: 10 }] }, 'integer greater than zero'],
      ['a negative quantity', { items: [{ sku: 'NB-001', quantity: -1, unitPrice: 10 }] }, 'integer greater than zero'],
      ['a fractional quantity', { items: [{ sku: 'NB-001', quantity: 1.5, unitPrice: 10 }] }, 'integer greater than zero'],
      ['a negative unit price', { items: [{ sku: 'NB-001', quantity: 1, unitPrice: -0.01 }] }, 'must not be negative'],
      ['a unit price that is not a number', { items: [{ sku: 'NB-001', quantity: 1, unitPrice: Number.NaN }] }, 'must not be negative'],
      ['a negative total', { total: -1 }, 'total of the order'],
      ['a total that is not a number', { total: Number.NaN }, 'total of the order'],
      ['an invalid date', { orderedAt: new Date('not a date') }, 'not a valid date'],
      ['an empty external id', { externalOrderId: '  ' }, 'must not be empty'],
    ])('refuses an order with %s', (_case, overrides, message) => {
      const receive = () => MarketplaceOrder.receive(props(overrides));

      expect(receive).toThrow(InvalidMarketplaceOrderError);
      expect(receive).toThrow(ValidationError);
      expect(receive).toThrow(message);
    });
  });
});
