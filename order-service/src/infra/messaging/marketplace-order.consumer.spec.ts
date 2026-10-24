import pino, { Logger } from 'pino';
import { Consumer, EachMessagePayload, IHeaders, Producer } from 'kafkajs';
import { context, propagation, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { InvalidMoneyError } from '../../core/shared/domain/money.vo';
import { ReceiveOrderPort, ReceiveOrderPortInput } from '../../core/order/port/in/receive-order.port';
import { OrderOutput } from '../../core/order/port/in/order.output';
import { Inbox } from './inbox';
import { MarketplaceOrderConsumer } from './marketplace-order.consumer';

const TOPIC = 'marketplace.order.received.v1';
const DEAD_LETTER_TOPIC = 'order.marketplace-order.dlq';
const KEY = 'MERCADO_LIVRE:ML-2000001';
const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';

const VALID = {
  marketplace: 'MERCADO_LIVRE',
  externalOrderId: 'ML-2000001',
  items: [{ sku: 'NB-001', quantity: 1, unitPrice: 4500 }],
  total: 4500,
  orderedAt: '2026-10-28T13:05:00.000Z',
};

const messageWith = (value: string | null, headers: IHeaders = { ce_id: 'ce-1' }): EachMessagePayload =>
  ({
    topic: TOPIC,
    partition: 2,
    message: { key: Buffer.from(KEY), value: value === null ? null : Buffer.from(value), offset: '7', headers },
  }) as unknown as EachMessagePayload;

const received = (body: unknown, headers?: IHeaders) => messageWith(JSON.stringify(body), headers);

const outputOf = (input: ReceiveOrderPortInput, total: number): OrderOutput => ({
  id: '6f1c2b8e-0000-4000-8000-000000000001',
  marketplace: input.marketplace,
  externalOrderId: input.externalOrderId,
  status: 'RECEIVED',
  total,
  items: input.items,
  cancellationReason: null,
  orderedAt: input.orderedAt,
  createdAt: new Date(),
  updatedAt: new Date(),
});

interface LogLine {
  level: number;
  msg: string;
  [field: string]: unknown;
}

describe('MarketplaceOrderConsumer', () => {
  const receivePort: jest.Mocked<ReceiveOrderPort> = { receive: jest.fn() };
  const consumer = { connect: jest.fn(), subscribe: jest.fn(), run: jest.fn() };
  const producer = { send: jest.fn() };
  const inbox: jest.Mocked<Inbox> = { hasProcessed: jest.fn(), markProcessed: jest.fn() };
  let lines: LogLine[];
  let logger: Logger;

  const handle = async (payload: EachMessagePayload): Promise<void> => {
    const ordersConsumer = new MarketplaceOrderConsumer(
      receivePort,
      consumer as unknown as Consumer,
      producer as unknown as Producer,
      inbox,
      { topic: TOPIC, deadLetterTopic: DEAD_LETTER_TOPIC },
      logger,
    );
    await ordersConsumer.start();
    const { eachMessage } = consumer.run.mock.calls[0][0];
    await eachMessage(payload);
  };

  const expectDeadLetter = (reason: string | RegExp): void => {
    expect(receivePort.receive).not.toHaveBeenCalled();
    expect(producer.send).toHaveBeenCalledTimes(1);
    const { topic, messages } = producer.send.mock.calls[0][0];
    expect(topic).toBe(DEAD_LETTER_TOPIC);
    expect(messages[0].key.toString()).toBe(KEY);
    expect(messages[0].headers).toEqual(expect.objectContaining({
      ce_id: 'ce-1',
      'dlq-original-topic': TOPIC,
      'dlq-original-partition': '2',
      'dlq-original-offset': '7',
      'dlq-reason': expect.stringMatching(reason),
    }));
  };

  beforeAll(() => {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  });

  afterAll(() => {
    context.disable();
    propagation.disable();
  });

  beforeEach(() => {
    jest.resetAllMocks();
    lines = [];
    logger = pino({ level: 'info' }, { write: (line: string) => lines.push(JSON.parse(line)) });
    inbox.hasProcessed.mockResolvedValue(false);
    receivePort.receive.mockImplementation(async input => ({ outcome: 'created', order: outputOf(input, 4500) }));
  });

  it('subscribes to the received orders topic from the beginning', async () => {
    await handle(received(VALID));

    expect(consumer.connect).toHaveBeenCalled();
    expect(consumer.subscribe).toHaveBeenCalledWith({ topics: [TOPIC], fromBeginning: true });
  });

  describe('a valid message', () => {
    it('becomes an order with the marketplace data, the date and the ce_id', async () => {
      await handle(received(VALID));

      expect(receivePort.receive).toHaveBeenCalledWith({
        eventId: 'ce-1',
        marketplace: 'MERCADO_LIVRE',
        externalOrderId: 'ML-2000001',
        items: [{ sku: 'NB-001', quantity: 1, unitPrice: 4500 }],
        orderedAt: new Date('2026-10-28T13:05:00Z'),
      });
      expect(producer.send).not.toHaveBeenCalled();
    });

    it('is processed without a ce_id, deduplicated only by the marketplace order', async () => {
      await handle(received(VALID, {}));

      expect(inbox.hasProcessed).not.toHaveBeenCalled();
      expect(receivePort.receive).toHaveBeenCalledWith(expect.objectContaining({ eventId: undefined }));
    });

    it('ignores fields that are not part of the contract', async () => {
      await handle(received({ ...VALID, buyer: { name: 'Ana' }, items: [{ ...VALID.items[0], title: 'Notebook' }] }));

      expect(receivePort.receive).toHaveBeenCalledWith(expect.objectContaining({ items: [{ sku: 'NB-001', quantity: 1, unitPrice: 4500 }] }));
      expect(producer.send).not.toHaveBeenCalled();
    });

    it('logs a warn with both totals when the declared total differs from the items', async () => {
      await handle(received({ ...VALID, total: 4000 }));

      const warns = lines.filter(line => line.level === 40);
      expect(warns).toHaveLength(1);
      expect(warns[0]).toEqual(expect.objectContaining({
        marketplace: 'MERCADO_LIVRE',
        externalOrderId: 'ML-2000001',
        declaredTotal: 4000,
        total: 4500,
      }));
      expect(warns[0]).not.toHaveProperty('items');
    });

    it('logs no warn when the declared total matches the items', async () => {
      await handle(received(VALID));

      expect(lines.filter(line => line.level === 40)).toEqual([]);
    });

    it('runs inside the trace of the message', async () => {
      let traceId: string | undefined;
      receivePort.receive.mockImplementation(async input => {
        traceId = trace.getSpanContext(context.active())?.traceId;
        return { outcome: 'created', order: outputOf(input, 4500) };
      });

      await handle(received(VALID, { ce_id: 'ce-1', traceparent: `00-${TRACE_ID}-b7ad6b7169203331-01` }));

      expect(traceId).toBe(TRACE_ID);
    });
  });

  it('skips a ce_id already in the inbox and logs it', async () => {
    inbox.hasProcessed.mockResolvedValue(true);

    await handle(received(VALID));

    expect(inbox.hasProcessed).toHaveBeenCalledWith('ce-1');
    expect(receivePort.receive).not.toHaveBeenCalled();
    expect(producer.send).not.toHaveBeenCalled();
    expect(lines).toContainEqual(expect.objectContaining({ level: 30, eventId: 'ce-1' }));
  });

  describe('a message outside the contract goes to the dead letter topic', () => {
    it.each([
      ['an empty value', null, /no value/],
      ['invalid JSON', '{"marketplace":', /not valid JSON/],
    ])('with %s', async (_, value, reason) => {
      await handle(messageWith(value));

      expectDeadLetter(reason);
    });

    it.each([
      ['an unknown marketplace', { ...VALID, marketplace: 'EBAY' }, /marketplace/],
      ['a blank external id', { ...VALID, externalOrderId: '  ' }, /externalOrderId/],
      ['no external id', { ...VALID, externalOrderId: undefined }, /externalOrderId/],
      ['no items', { ...VALID, items: [] }, /items/],
      ['a blank SKU', { ...VALID, items: [{ ...VALID.items[0], sku: ' ' }] }, /sku/],
      ['a quantity of 0', { ...VALID, items: [{ ...VALID.items[0], quantity: 0 }] }, /quantity/],
      ['a fractional quantity', { ...VALID, items: [{ ...VALID.items[0], quantity: 1.5 }] }, /quantity/],
      ['a negative unit price', { ...VALID, items: [{ ...VALID.items[0], unitPrice: -1 }] }, /unitPrice/],
      ['a unit price that is not a number', { ...VALID, items: [{ ...VALID.items[0], unitPrice: '4500' }] }, /unitPrice/],
      ['an orderedAt that is not an instant', { ...VALID, orderedAt: 'ontem' }, /orderedAt/],
      ['a total that is not a number', { ...VALID, total: '4500' }, /total/],
    ])('with %s', async (_, body, reason) => {
      await handle(received(body));

      expectDeadLetter(reason);
    });

    it('with a unit price of more than two decimals, refused by the domain', async () => {
      receivePort.receive.mockRejectedValue(new InvalidMoneyError('1.234 is not an amount in reais with at most two decimals.'));

      await handle(received({ ...VALID, items: [{ ...VALID.items[0], unitPrice: 1.234 }] }));

      expect(producer.send).toHaveBeenCalledTimes(1);
      expect(producer.send.mock.calls[0][0].messages[0].headers['dlq-reason']).toContain('two decimals');
    });

    it('marks its ce_id in the inbox and logs a warn with its position and the reason', async () => {
      await handle(received({ ...VALID, marketplace: 'EBAY' }));

      expect(inbox.markProcessed).toHaveBeenCalledWith('ce-1', TOPIC);
      expect(lines).toContainEqual(expect.objectContaining({
        level: 40,
        topic: TOPIC,
        partition: 2,
        offset: '7',
        reason: expect.stringContaining('marketplace'),
      }));
    });
  });

  it('rethrows an infrastructure error so Kafka redelivers the message, and sends nothing to the dead letter topic', async () => {
    receivePort.receive.mockRejectedValue(new Error('connection terminated'));

    await expect(handle(received(VALID))).rejects.toThrow('connection terminated');

    expect(producer.send).not.toHaveBeenCalled();
    expect(inbox.markProcessed).not.toHaveBeenCalled();
  });
});
