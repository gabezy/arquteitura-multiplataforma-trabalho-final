import { ValidationError } from '../../shared/domain/domain.error';
import { Order, ReceiveOrderProps } from './order.entity';
import { InvalidOrderError } from './order.errors';
import { OrderPlaced } from './order-placed.event';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ORDERED_AT = new Date('2026-10-28T13:05:00Z');

const props = (overrides: Partial<ReceiveOrderProps> = {}): ReceiveOrderProps => ({
  marketplace: 'AMAZON',
  externalOrderId: 'AMZ-1000002',
  items: [
    { sku: 'OXI-001', quantity: 1, unitPrice: 189.9 },
    { sku: 'MON-002', quantity: 2, unitPrice: 18500 },
  ],
  orderedAt: ORDERED_AT,
  ...overrides,
});

const item = (overrides: Partial<ReceiveOrderProps['items'][number]>) => ({ sku: 'NB-001', quantity: 1, unitPrice: 4500, ...overrides });

describe('Order', () => {
  describe('receive', () => {
    it('creates a RECEIVED order with a new UUID and the marketplace data', () => {
      const order = Order.receive(props());

      expect(order.id.value).toMatch(UUID);
      expect(order.status).toBe('RECEIVED');
      expect(order.cancellationReason).toBeNull();
      expect(order.marketplace).toBe('AMAZON');
      expect(order.externalOrderId).toBe('AMZ-1000002');
      expect(order.orderedAt).toEqual(ORDERED_AT);
      expect(order.items.map(({ sku, quantity, unitPrice }) => ({ sku, quantity, unitPrice: unitPrice.toReais() }))).toEqual([
        { sku: 'OXI-001', quantity: 1, unitPrice: 189.9 },
        { sku: 'MON-002', quantity: 2, unitPrice: 18500 },
      ]);
    });

    it('gives every order its own id', () => {
      expect(Order.receive(props()).id.value).not.toBe(Order.receive(props()).id.value);
    });

    it('sets the total to the sum of quantity times unit price, to the cent', () => {
      expect(Order.receive(props()).total.toReais()).toBe(37189.9);
      expect(Order.receive(props({ items: [item({ quantity: 3, unitPrice: 0.1 })] })).total.toReais()).toBe(0.3);
    });

    it('keeps an item priced 0 and adds nothing to the total', () => {
      const order = Order.receive(props({ items: [item({ unitPrice: 4500 }), item({ sku: 'BRINDE-01', unitPrice: 0 })] }));

      expect(order.items).toHaveLength(2);
      expect(order.items[1].unitPrice.toReais()).toBe(0);
      expect(order.total.toReais()).toBe(4500);
    });

    it('trims the SKUs and the external id', () => {
      const order = Order.receive(props({ externalOrderId: ' AMZ-1 ', items: [item({ sku: ' NB-001 ' })] }));

      expect(order.externalOrderId).toBe('AMZ-1');
      expect(order.items[0].sku).toBe('NB-001');
    });

    it('keeps two lines of the same SKU as two lines', () => {
      const order = Order.receive(props({ items: [item({ quantity: 1 }), item({ quantity: 2 })] }));

      expect(order.items.map(({ sku, quantity }) => ({ sku, quantity }))).toEqual([
        { sku: 'NB-001', quantity: 1 },
        { sku: 'NB-001', quantity: 2 },
      ]);
    });

    it('records one OrderPlaced with the order id, marketplace data and items', () => {
      const order = Order.receive(props());

      const [event, ...others] = order.pullDomainEvents();

      expect(others).toEqual([]);
      expect(event).toBeInstanceOf(OrderPlaced);
      const placed = event as OrderPlaced;
      expect(placed.aggregateId).toBe(order.id.value);
      expect(placed.marketplace).toBe('AMAZON');
      expect(placed.externalOrderId).toBe('AMZ-1000002');
      expect(placed.items.map(({ sku, quantity, unitPrice }) => ({ sku, quantity, unitPrice: unitPrice.toReais() }))).toEqual([
        { sku: 'OXI-001', quantity: 1, unitPrice: 189.9 },
        { sku: 'MON-002', quantity: 2, unitPrice: 18500 },
      ]);
    });

    it.each([
      ['no items', props({ items: [] })],
      ['a blank SKU', props({ items: [item({ sku: '  ' })] })],
      ['a quantity of 0', props({ items: [item({ quantity: 0 })] })],
      ['a fractional quantity', props({ items: [item({ quantity: 1.5 })] })],
      ['a negative quantity', props({ items: [item({ quantity: -1 })] })],
      ['a blank external id', props({ externalOrderId: ' ' })],
      ['an invalid date', props({ orderedAt: new Date('ontem') })],
    ])('rejects an order with %s', (_, invalid) => {
      expect(() => Order.receive(invalid)).toThrow(InvalidOrderError);
    });

    it.each([-1, 1.234])('rejects a unit price of %p', unitPrice => {
      expect(() => Order.receive(props({ items: [item({ unitPrice })] }))).toThrow(ValidationError);
    });
  });
});
