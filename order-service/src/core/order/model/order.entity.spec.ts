import { ConflictError, ValidationError } from '../../shared/domain/domain.error';
import { CancellationReason } from './cancellation-reason.vo';
import { Marketplace } from './marketplace.vo';
import { OrderStatus } from './order-status.vo';
import { Order, OrderSnapshot, ReceiveOrderInput } from './order.entity';
import { InvalidOrderError, OrderStateConflictError } from './order.errors';
import { OrderCancelled, OrderConfirmed, OrderPlaced } from './order.events';

const ORDER_ID = '6f1c2b8e-0000-4000-8000-000000000001';
const ORDERED_AT = new Date('2026-10-28T13:05:00Z');
const RECEIVED_AT = new Date('2026-10-28T13:05:01Z');
const LATER = new Date('2026-10-28T13:05:02Z');

const receiveInput = (overrides: Partial<ReceiveOrderInput> = {}): ReceiveOrderInput => ({
  marketplace: 'MERCADO_LIVRE',
  externalOrderId: 'ML-2000001',
  items: [{ sku: 'IPHONE-15', quantity: 1, unitPrice: 15000 }],
  total: 15000,
  orderedAt: ORDERED_AT,
  ...overrides,
});

const snapshotOf = (status: string, cancellationReason: string | null = null): OrderSnapshot => ({
  id: ORDER_ID,
  marketplace: 'MERCADO_LIVRE',
  externalOrderId: 'ML-2000001',
  status,
  totalCents: 1_500_000,
  cancellationReason,
  items: [{ sku: 'IPHONE-15', quantity: 1, unitPriceCents: 1_500_000 }],
  orderedAt: ORDERED_AT,
  updatedAt: RECEIVED_AT,
  version: 4,
});

describe('Order', () => {
  describe('receive', () => {
    it('is RECEIVED, with a new id, the data of the sale and the money in cents', () => {
      const order = Order.receive(receiveInput({
        items: [
          { sku: 'IPHONE-15', quantity: 2, unitPrice: 4500.5 },
          { sku: 'CASE-01', quantity: 3, unitPrice: 19.99 },
        ],
        total: 9060.97,
      }), RECEIVED_AT);

      expect(order.id.value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(order.status).toBe(OrderStatus.RECEIVED);
      expect(order.marketplace).toBe(Marketplace.MERCADO_LIVRE);
      expect(order.externalOrderId).toBe('ML-2000001');
      expect(order.items.map(item => item.value)).toEqual([
        { sku: 'IPHONE-15', quantity: 2, unitPriceCents: 450_050 },
        { sku: 'CASE-01', quantity: 3, unitPriceCents: 1999 },
      ]);
      expect(order.total.value).toBe(906_097);
      expect(order.cancellationReason).toBeNull();
      expect(order.orderedAt).toEqual(ORDERED_AT);
      expect(order.updatedAt).toEqual(RECEIVED_AT);
      expect(order.version).toBe(0);
    });

    it('gives each order its own id', () => {
      expect(Order.receive(receiveInput(), RECEIVED_AT).id.equals(Order.receive(receiveInput(), RECEIVED_AT).id)).toBe(false);
    });

    it('records OrderPlaced with the id, the marketplace, the external order id and the items', () => {
      const order = Order.receive(receiveInput(), RECEIVED_AT);

      const events = order.pullDomainEvents();

      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(OrderPlaced);
      expect(events[0]).toMatchObject({
        aggregateId: order.id.value,
        marketplace: 'MERCADO_LIVRE',
        externalOrderId: 'ML-2000001',
        items: [{ sku: 'IPHONE-15', quantity: 1, unitPriceCents: 1_500_000 }],
      });
      expect(order.pullDomainEvents()).toEqual([]);
    });

    it('trims the SKU and the external order id', () => {
      const order = Order.receive(receiveInput({
        externalOrderId: '  ML-2000001\n',
        items: [{ sku: ' IPHONE-15 ', quantity: 1, unitPrice: 15000 }],
      }), RECEIVED_AT);

      expect(order.externalOrderId).toBe('ML-2000001');
      expect(order.items[0].sku).toBe('IPHONE-15');
    });

    it('keeps the lines of the same SKU as received', () => {
      const order = Order.receive(receiveInput({
        items: [
          { sku: 'CASE-01', quantity: 1, unitPrice: 10 },
          { sku: 'CASE-01', quantity: 2, unitPrice: 10 },
        ],
        total: 30,
      }), RECEIVED_AT);

      expect(order.items.map(item => item.value)).toEqual([
        { sku: 'CASE-01', quantity: 1, unitPriceCents: 1000 },
        { sku: 'CASE-01', quantity: 2, unitPriceCents: 1000 },
      ]);
    });

    it('accepts 100 items and sums them in cents, where floats would drift', () => {
      const items = Array.from({ length: 100 }, (_, index) => ({ sku: `SKU-${index}`, quantity: 1, unitPrice: 0.1 }));

      const order = Order.receive(receiveInput({ items, total: 10 }), RECEIVED_AT);

      expect(order.items).toHaveLength(100);
      expect(order.total.value).toBe(1000);
    });

    it('accepts the largest order the billing-service can charge', () => {
      const items = Array.from({ length: 100 }, (_, index) => ({ sku: `SKU-${index}`, quantity: 10_000, unitPrice: 1_000_000 }));

      const order = Order.receive(receiveInput({ items, total: 1_000_000_000_000 }), RECEIVED_AT);

      expect(order.total.value).toBe(100_000_000_000_000);
    });

    it.each(['AMAZON', 'MERCADO_LIVRE', 'SHOPEE'])('accepts the marketplace %s', marketplace => {
      expect(Order.receive(receiveInput({ marketplace }), RECEIVED_AT).marketplace.value).toBe(marketplace);
    });

    describe('rejects with an InvalidOrderError', () => {
      const tooMany = Array.from({ length: 101 }, (_, index) => ({ sku: `SKU-${index}`, quantity: 1, unitPrice: 1 }));

      it.each<[string, Partial<ReceiveOrderInput>]>([
        ['an unknown marketplace', { marketplace: 'EBAY' }],
        ['a blank marketplace', { marketplace: '' }],
        ['a blank external order id', { externalOrderId: '   ' }],
        ['an external order id that is not text', { externalOrderId: undefined as unknown as string }],
        ['an external order id longer than 100 characters', { externalOrderId: 'E'.repeat(101) }],
        ['no items', { items: [], total: 0 }],
        ['more than 100 items', { items: tooMany, total: 101 }],
        ['items that are not a list', { items: undefined as unknown as ReceiveOrderInput['items'] }],
        ['a quantity of zero', { items: [{ sku: 'A', quantity: 0, unitPrice: 15000 }] }],
        ['a quantity above 10000', { items: [{ sku: 'A', quantity: 10_001, unitPrice: 1 }], total: 10_001 }],
        ['a fractional quantity', { items: [{ sku: 'A', quantity: 1.5, unitPrice: 10 }], total: 15 }],
        ['a unit price of zero', { items: [{ sku: 'A', quantity: 1, unitPrice: 0 }], total: 0 }],
        ['a unit price above 1000000.00', { items: [{ sku: 'A', quantity: 1, unitPrice: 1_000_000.01 }], total: 1_000_000.01 }],
        ['a unit price with more than two decimals', { items: [{ sku: 'A', quantity: 1, unitPrice: 10.005 }], total: 10.01 }],
        ['a unit price with float noise', { items: [{ sku: 'A', quantity: 1, unitPrice: 0.1 + 0.2 }], total: 0.3 }],
        ['a blank SKU', { items: [{ sku: ' ', quantity: 1, unitPrice: 15000 }] }],
        ['a total below the sum of the items', { total: 14999.99 }],
        ['a total above the sum of the items', { total: 15000.01 }],
        ['a total of zero', { total: 0 }],
        ['a negative total', { total: -15000 }],
        ['a total with more than two decimals', { total: 15000.001 }],
        ['an invalid ordered at', { orderedAt: new Date('not a date') }],
        ['an ordered at that is not a date', { orderedAt: '2026-10-28T13:05:00Z' as unknown as Date }],
      ])('%s', (_, overrides) => {
        expect(() => Order.receive(receiveInput(overrides), RECEIVED_AT)).toThrow(InvalidOrderError);
      });

      it('as a ValidationError, so adapters send it to the dead letter or answer 422', () => {
        expect(() => Order.receive(receiveInput({ marketplace: 'EBAY' }), RECEIVED_AT)).toThrow(ValidationError);
      });
    });
  });

  describe('transitions', () => {
    type Transition = 'confirm' | 'cancelForStock' | 'markPaid' | 'cancelForPayment';
    type Outcome = 'changes' | 'repeats' | 'conflicts';

    const received = snapshotOf('RECEIVED');
    const confirmed = snapshotOf('CONFIRMED');
    const paid = snapshotOf('PAID');
    const noStock = snapshotOf('CANCELLED', 'OUT_OF_STOCK');
    const paymentFailed = snapshotOf('CANCELLED', 'PAYMENT_FAILED');
    const cancelledByBuyer = snapshotOf('CANCELLED', 'MARKETPLACE_CANCELLED');

    // Rows are the state the order is in, columns are the outcome that arrives.
    it.each<[string, OrderSnapshot, Transition, Outcome]>([
      ['RECEIVED', received, 'confirm', 'changes'],
      ['RECEIVED', received, 'cancelForStock', 'changes'],
      ['RECEIVED', received, 'markPaid', 'conflicts'],
      ['RECEIVED', received, 'cancelForPayment', 'conflicts'],

      ['CONFIRMED', confirmed, 'confirm', 'repeats'],
      ['CONFIRMED', confirmed, 'cancelForStock', 'conflicts'],
      ['CONFIRMED', confirmed, 'markPaid', 'changes'],
      ['CONFIRMED', confirmed, 'cancelForPayment', 'changes'],

      ['PAID', paid, 'confirm', 'repeats'],
      ['PAID', paid, 'cancelForStock', 'conflicts'],
      ['PAID', paid, 'markPaid', 'repeats'],
      ['PAID', paid, 'cancelForPayment', 'conflicts'],

      ['CANCELLED for OUT_OF_STOCK', noStock, 'confirm', 'conflicts'],
      ['CANCELLED for OUT_OF_STOCK', noStock, 'cancelForStock', 'repeats'],
      ['CANCELLED for OUT_OF_STOCK', noStock, 'markPaid', 'conflicts'],
      ['CANCELLED for OUT_OF_STOCK', noStock, 'cancelForPayment', 'conflicts'],

      ['CANCELLED for PAYMENT_FAILED', paymentFailed, 'confirm', 'repeats'],
      ['CANCELLED for PAYMENT_FAILED', paymentFailed, 'cancelForStock', 'conflicts'],
      ['CANCELLED for PAYMENT_FAILED', paymentFailed, 'markPaid', 'conflicts'],
      ['CANCELLED for PAYMENT_FAILED', paymentFailed, 'cancelForPayment', 'repeats'],

      ['CANCELLED for MARKETPLACE_CANCELLED', cancelledByBuyer, 'confirm', 'conflicts'],
      ['CANCELLED for MARKETPLACE_CANCELLED', cancelledByBuyer, 'cancelForStock', 'conflicts'],
      ['CANCELLED for MARKETPLACE_CANCELLED', cancelledByBuyer, 'markPaid', 'conflicts'],
      ['CANCELLED for MARKETPLACE_CANCELLED', cancelledByBuyer, 'cancelForPayment', 'conflicts'],
    ])('an order %s that gets %s %s', (_state, snapshot, transition, outcome) => {
      const order = Order.restore(snapshot);

      if (outcome === 'conflicts') {
        expect(() => order[transition](LATER)).toThrow(OrderStateConflictError);
      } else {
        expect(order[transition](LATER)).toBe(outcome === 'changes');
      }

      if (outcome !== 'changes') {
        expect(order.status.value).toBe(snapshot.status);
        expect(order.cancellationReason?.value ?? null).toBe(snapshot.cancellationReason);
        expect(order.updatedAt).toEqual(RECEIVED_AT);
        expect(order.pullDomainEvents()).toEqual([]);
      }
    });

    describe('confirm', () => {
      it('confirms a RECEIVED order and records OrderConfirmed with the data of the contract', () => {
        const order = Order.restore(received);

        const changed = order.confirm(LATER);

        expect(changed).toBe(true);
        expect(order.status).toBe(OrderStatus.CONFIRMED);
        expect(order.cancellationReason).toBeNull();
        expect(order.updatedAt).toEqual(LATER);
        const events = order.pullDomainEvents();
        expect(events).toHaveLength(1);
        expect(events[0]).toBeInstanceOf(OrderConfirmed);
        expect(events[0]).toMatchObject({
          aggregateId: ORDER_ID,
          marketplace: 'MERCADO_LIVRE',
          externalOrderId: 'ML-2000001',
          items: [{ sku: 'IPHONE-15', quantity: 1, unitPriceCents: 1_500_000 }],
          totalCents: 1_500_000,
          confirmedAt: LATER,
        });
      });
    });

    describe('cancelForStock', () => {
      it('cancels a RECEIVED order for lack of stock and records OrderCancelled with the reason', () => {
        const order = Order.restore(received);

        const changed = order.cancelForStock(LATER);

        expect(changed).toBe(true);
        expect(order.status).toBe(OrderStatus.CANCELLED);
        expect(order.cancellationReason).toBe(CancellationReason.OUT_OF_STOCK);
        expect(order.updatedAt).toEqual(LATER);
        const events = order.pullDomainEvents();
        expect(events).toHaveLength(1);
        expect(events[0]).toBeInstanceOf(OrderCancelled);
        expect(events[0]).toMatchObject({
          aggregateId: ORDER_ID,
          reason: 'OUT_OF_STOCK',
          marketplace: 'MERCADO_LIVRE',
          externalOrderId: 'ML-2000001',
        });
      });
    });

    describe('markPaid', () => {
      it('pays a CONFIRMED order and records no event', () => {
        const order = Order.restore(confirmed);

        const changed = order.markPaid(LATER);

        expect(changed).toBe(true);
        expect(order.status).toBe(OrderStatus.PAID);
        expect(order.cancellationReason).toBeNull();
        expect(order.updatedAt).toEqual(LATER);
        expect(order.pullDomainEvents()).toEqual([]);
      });
    });

    describe('cancelForPayment', () => {
      it('cancels a CONFIRMED order for the failed payment and records OrderCancelled with the reason', () => {
        const order = Order.restore(confirmed);

        const changed = order.cancelForPayment(LATER);

        expect(changed).toBe(true);
        expect(order.status).toBe(OrderStatus.CANCELLED);
        expect(order.cancellationReason).toBe(CancellationReason.PAYMENT_FAILED);
        expect(order.updatedAt).toEqual(LATER);
        const events = order.pullDomainEvents();
        expect(events).toHaveLength(1);
        expect(events[0]).toBeInstanceOf(OrderCancelled);
        expect(events[0]).toMatchObject({
          aggregateId: ORDER_ID,
          reason: 'PAYMENT_FAILED',
          marketplace: 'MERCADO_LIVRE',
          externalOrderId: 'ML-2000001',
        });
      });
    });

    describe('a conflict', () => {
      it('is a ConflictError that names the order, its state and what was attempted', () => {
        const order = Order.restore(noStock);

        expect(() => order.markPaid(LATER)).toThrow(ConflictError);
        expect(() => order.markPaid(LATER)).toThrow(`Order ${ORDER_ID} is CANCELLED (OUT_OF_STOCK) and cannot be paid.`);
        expect(() => Order.restore(paid).cancelForStock(LATER)).toThrow(
          `Order ${ORDER_ID} is PAID and cannot be cancelled for lack of stock.`,
        );
      });
    });

    it('follows the whole life of an order that is paid, with its events in order', () => {
      const order = Order.receive(receiveInput(), RECEIVED_AT);

      order.confirm(LATER);
      order.markPaid(new Date('2026-10-28T13:05:06Z'));

      expect(order.status).toBe(OrderStatus.PAID);
      expect(order.pullDomainEvents().map(event => event.eventName)).toEqual(['OrderPlaced', 'OrderConfirmed']);
    });

    it('follows the whole life of an order whose payment fails, with its events in order', () => {
      const order = Order.receive(receiveInput(), RECEIVED_AT);

      order.confirm(LATER);
      order.cancelForPayment(new Date('2026-10-28T13:05:06Z'));

      expect(order.status).toBe(OrderStatus.CANCELLED);
      expect(order.cancellationReason).toBe(CancellationReason.PAYMENT_FAILED);
      expect(order.pullDomainEvents().map(event => event.eventName)).toEqual(['OrderPlaced', 'OrderConfirmed', 'OrderCancelled']);
    });

    it('repeats an outcome without recording it twice', () => {
      const order = Order.restore(received);

      order.confirm(LATER);
      order.confirm(new Date('2026-10-28T13:05:09Z'));

      expect(order.updatedAt).toEqual(LATER);
      expect(order.pullDomainEvents()).toHaveLength(1);
    });
  });

  describe('restore', () => {
    it('rebuilds the order from what was stored and records no event', () => {
      const order = Order.restore(snapshotOf('CANCELLED', 'PAYMENT_FAILED'));

      expect(order.id.value).toBe(ORDER_ID);
      expect(order.marketplace).toBe(Marketplace.MERCADO_LIVRE);
      expect(order.externalOrderId).toBe('ML-2000001');
      expect(order.status).toBe(OrderStatus.CANCELLED);
      expect(order.cancellationReason).toBe(CancellationReason.PAYMENT_FAILED);
      expect(order.total.value).toBe(1_500_000);
      expect(order.items.map(item => item.value)).toEqual([{ sku: 'IPHONE-15', quantity: 1, unitPriceCents: 1_500_000 }]);
      expect(order.orderedAt).toEqual(ORDERED_AT);
      expect(order.updatedAt).toEqual(RECEIVED_AT);
      expect(order.version).toBe(4);
      expect(order.pullDomainEvents()).toEqual([]);
    });

    it.each<[string, Partial<OrderSnapshot>]>([
      ['a cancelled order without a reason', { status: 'CANCELLED', cancellationReason: null }],
      ['an order with a reason that is not cancelled', { status: 'CONFIRMED', cancellationReason: 'OUT_OF_STOCK' }],
      ['an unknown status', { status: 'SHIPPED' }],
      ['an unknown reason', { status: 'CANCELLED', cancellationReason: 'CHANGED_MIND' }],
      ['an unknown marketplace', { marketplace: 'EBAY' }],
      ['a total that differs from the sum of the items', { totalCents: 1_500_001 }],
      ['no items', { items: [], totalCents: 0 }],
    ])('rejects %s', (_, overrides) => {
      expect(() => Order.restore({ ...snapshotOf('RECEIVED'), ...overrides })).toThrow(InvalidOrderError);
    });
  });

  describe('equals', () => {
    it('compares orders by id', () => {
      expect(Order.restore(snapshotOf('RECEIVED')).equals(Order.restore(snapshotOf('PAID')))).toBe(true);
      expect(Order.restore(snapshotOf('RECEIVED')).equals(Order.receive(receiveInput(), RECEIVED_AT))).toBe(false);
    });
  });
});
