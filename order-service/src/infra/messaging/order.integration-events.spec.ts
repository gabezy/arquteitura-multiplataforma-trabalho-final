import { Order } from '../../core/order/model/order.entity';
import { DomainEvent } from '../../core/shared/domain/domain.event';
import { toOrderIntegrationEvent } from './order.integration-events';

class Unmapped extends DomainEvent {
  readonly eventName = 'Unmapped';

  constructor() {
    super('6f1c2b8e-0000-4000-8000-000000000001');
  }
}

describe('toOrderIntegrationEvent', () => {
  it('maps OrderPlaced to order.order.placed.v1 with the items priced in reais', () => {
    const order = Order.receive({
      marketplace: 'MERCADO_LIVRE',
      externalOrderId: 'ML-2000001',
      items: [{ sku: 'NB-001', quantity: 1, unitPrice: 4500 }, { sku: 'OXI-001', quantity: 3, unitPrice: 189.9 }],
      orderedAt: new Date('2026-10-28T13:05:00Z'),
    });
    const [placed] = order.pullDomainEvents();

    expect(toOrderIntegrationEvent(placed)).toEqual({
      type: 'order.order.placed.v1',
      data: {
        orderId: order.id.value,
        marketplace: 'MERCADO_LIVRE',
        externalOrderId: 'ML-2000001',
        items: [{ sku: 'NB-001', quantity: 1, unitPrice: 4500 }, { sku: 'OXI-001', quantity: 3, unitPrice: 189.9 }],
      },
    });
  });

  it('throws for an event without a public contract', () => {
    expect(() => toOrderIntegrationEvent(new Unmapped())).toThrow('No integration event for Unmapped.');
  });
});
