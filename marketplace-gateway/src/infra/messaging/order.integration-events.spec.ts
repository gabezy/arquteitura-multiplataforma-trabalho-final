import { MarketplaceOrder } from '../../core/order/model/marketplace-order.entity';
import { DomainEvent } from '../../core/shared/domain/domain.event';
import { toOrderIntegrationEvent } from './order.integration-events';

class Unrelated extends DomainEvent {
  readonly eventName = 'Unrelated';

  constructor() {
    super('x');
  }
}

describe('toOrderIntegrationEvent', () => {
  it('turns the received order into marketplace.order.received.v1, with the data of the contract', () => {
    const order = MarketplaceOrder.receive({
      marketplace: 'MERCADO_LIVRE',
      externalOrderId: '2000001',
      items: [{ sku: 'NB-001', quantity: 1, unitPrice: 4500 }],
      total: 4500,
      orderedAt: new Date('2026-10-28T13:05:00Z'),
    });
    const [event] = order.pullDomainEvents();

    expect(toOrderIntegrationEvent(event)).toEqual({
      type: 'marketplace.order.received.v1',
      data: {
        marketplace: 'MERCADO_LIVRE',
        externalOrderId: '2000001',
        items: [{ sku: 'NB-001', quantity: 1, unitPrice: 4500 }],
        total: 4500,
        orderedAt: '2026-10-28T13:05:00.000Z',
      },
    });
  });

  it('publishes the key of the order as the aggregate of the event', () => {
    const order = MarketplaceOrder.receive({
      marketplace: 'SHOPEE',
      externalOrderId: 'SHP1',
      items: [{ sku: 'NB-001', quantity: 1, unitPrice: 10 }],
      total: 10,
      orderedAt: new Date(),
    });

    expect(order.pullDomainEvents()[0].aggregateId).toBe('SHOPEE:SHP1');
  });

  it('refuses an event that has no public contract', () => {
    expect(() => toOrderIntegrationEvent(new Unrelated())).toThrow('No integration event for Unrelated.');
  });
});
