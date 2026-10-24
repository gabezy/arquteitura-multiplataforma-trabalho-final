import { context, propagation, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { Consumer, EachMessagePayload, IHeaders, Producer } from 'kafkajs';
import pino from 'pino';
import { ReceiveOrderPort } from '../../core/order/port/in/receive-order.port';
import { Inbox } from './inbox';
import { MarketplaceOrderConsumer } from './marketplace-order.consumer';

const TOPIC = 'marketplace.order.received.v1';
const DEAD_LETTER_TOPIC = 'order.marketplace-order.dlq';
const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const BODY = {
    marketplace: 'MERCADO_LIVRE',
    externalOrderId: 'ML-2000001',
    items: [{ sku: 'NB-001', quantity: 3, unitPrice: 0.1 }],
    total: 0.3,
    orderedAt: '2026-10-28T13:05:00.000Z',
};

const headers = (body: { marketplace: string; externalOrderId: string } = BODY, overrides: IHeaders = {}): IHeaders => ({
    ce_specversion: '1.0',
    ce_id: 'event-1',
    ce_source: '/marketplace-gateway',
    ce_type: TOPIC,
    ce_subject: `${body.marketplace}:${body.externalOrderId}`,
    ce_time: '2026-10-28T13:05:01.000Z',
    'content-type': 'application/json',
    ...overrides,
});

const message = (value: unknown, eventHeaders = headers(typeof value === 'object' && value !== null ? value as typeof BODY : BODY)): EachMessagePayload => ({
    topic: TOPIC,
    partition: 2,
    message: {
        key: Buffer.from('MERCADO_LIVRE:ML-2000001'),
        value: value === null ? null : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)),
        offset: '7',
        headers: eventHeaders,
    },
} as unknown as EachMessagePayload);

describe('MarketplaceOrderConsumer', () => {
    const kafkaConsumer = { connect: jest.fn(), subscribe: jest.fn(), run: jest.fn(), disconnect: jest.fn() };
    const producer = { send: jest.fn() };
    const receiveOrder: jest.Mocked<ReceiveOrderPort> = { receive: jest.fn() };
    const inbox: jest.Mocked<Inbox> = { hasProcessed: jest.fn(), markProcessed: jest.fn() };
    const logger = pino({ level: 'silent' });

    const handle = async (payload: EachMessagePayload): Promise<void> => {
        const consumer = new MarketplaceOrderConsumer({
            consumer: kafkaConsumer as unknown as Consumer,
            producer: producer as unknown as Producer,
            receiveOrder,
            inbox,
            logger,
        });
        await consumer.start();
        const { eachMessage } = kafkaConsumer.run.mock.calls[0][0];
        await eachMessage(payload);
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
        inbox.hasProcessed.mockResolvedValue(false);
        receiveOrder.receive.mockResolvedValue({ orderId: '6f1c2b8e-0000-4000-8000-000000000001', created: true });
    });

    it('subscribes from the beginning and gives the order the exact item total and event id', async () => {
        await handle(message(BODY));

        expect(kafkaConsumer.subscribe).toHaveBeenCalledWith({ topics: [TOPIC], fromBeginning: true });
        expect(receiveOrder.receive).toHaveBeenCalledWith({
            eventId: 'event-1',
            marketplace: 'MERCADO_LIVRE',
            externalOrderId: 'ML-2000001',
            items: [{ sku: 'NB-001', quantity: 3, unitPrice: 0.1 }],
            total: 0.3,
            orderedAt: new Date('2026-10-28T13:05:00.000Z'),
        });
        expect(producer.send).not.toHaveBeenCalled();
    });

    it('ignores the marketplace total and lets the item sum win', async () => {
        const warn = jest.spyOn(logger, 'warn');

        await handle(message({ ...BODY, total: 10 }));

        expect(receiveOrder.receive).toHaveBeenCalledWith(expect.objectContaining({ total: 0.3 }));
        expect(producer.send).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledWith(
            { marketplace: 'MERCADO_LIVRE', externalOrderId: 'ML-2000001', declaredTotal: 10, total: 0.3 },
            'Declared total differs from the items; using the items',
        );
        warn.mockRestore();
    });

    it('logs no warning when the declared total matches the items', async () => {
        const warn = jest.spyOn(logger, 'warn');

        await handle(message(BODY));

        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    it('skips an event id already recorded in the inbox', async () => {
        inbox.hasProcessed.mockResolvedValue(true);

        await handle(message(BODY));

        expect(inbox.hasProcessed).toHaveBeenCalledWith('event-1');
        expect(receiveOrder.receive).not.toHaveBeenCalled();
    });

    it.each([
        ['malformed JSON', '{', /valid JSON/],
        ['unknown marketplace', { ...BODY, marketplace: 'EBAY' }, /marketplace/],
        ['empty items', { ...BODY, items: [] }, /items/],
        ['zero quantity', { ...BODY, items: [{ ...BODY.items[0], quantity: 0 }] }, /quantity/],
        ['free item rejected by billing constraints', { ...BODY, items: [{ ...BODY.items[0], unitPrice: 0 }] }, /unitPrice/],
        ['excess quantity', { ...BODY, items: [{ ...BODY.items[0], quantity: 10_001 }] }, /quantity/],
        ['excess item count', { ...BODY, items: Array.from({ length: 101 }, () => BODY.items[0]) }, /items/],
        ['NUL in SKU', { ...BODY, items: [{ ...BODY.items[0], sku: 'NB-\u000001' }] }, /sku/],
        ['blank SKU', { ...BODY, items: [{ ...BODY.items[0], sku: '   ' }] }, /sku/],
        ['SKU longer than 64 characters', { ...BODY, items: [{ ...BODY.items[0], sku: 'S'.repeat(65) }] }, /sku/],
        ['blank external order id', { ...BODY, externalOrderId: '   ' }, /externalOrderId/],
        ['external order id longer than 100 characters', { ...BODY, externalOrderId: 'E'.repeat(101) }, /externalOrderId/],
        ['unit price with more than two decimals', { ...BODY, items: [{ ...BODY.items[0], unitPrice: 0.123 }] }, /decimal/i],
        ['orderedAt that is not ISO-8601', { ...BODY, orderedAt: 'ontem' }, /orderedAt/],
    ])('sends %s to the dead letter topic', async (_name, value, reason) => {
        const payload = message(value);
        await handle(payload);

        expect(receiveOrder.receive).not.toHaveBeenCalled();
        expect(producer.send).toHaveBeenCalledWith(expect.objectContaining({
            topic: DEAD_LETTER_TOPIC,
            messages: [expect.objectContaining({
                headers: expect.objectContaining({
                    'dlq-original-topic': TOPIC,
                    'dlq-original-partition': '2',
                    'dlq-original-offset': '7',
                    'dlq-reason': expect.stringMatching(reason),
                }),
            })],
        }));
        expect(inbox.markProcessed).toHaveBeenCalledWith('event-1', TOPIC);
    });

    it('accepts a SKU of exactly 64 characters', async () => {
        await handle(message({ ...BODY, items: [{ ...BODY.items[0], sku: 'S'.repeat(64) }] }));

        expect(receiveOrder.receive).toHaveBeenCalledWith(expect.objectContaining({ items: [expect.objectContaining({ sku: 'S'.repeat(64) })] }));
        expect(producer.send).not.toHaveBeenCalled();
    });

    it.each([
        ['ce_specversion is missing', { ce_specversion: undefined }, 'ce_specversion'],
        ['ce_type is another topic', { ce_type: 'catalog.stock.reserved.v1' }, 'ce_type'],
        ['ce_subject names another order', { ce_subject: 'MERCADO_LIVRE:ML-9999999' }, 'ce_subject'],
    ])('sends a message whose %s to the dead letter topic', async (_name, overrides, reason) => {
        await handle(message(BODY, headers(BODY, overrides)));

        expect(receiveOrder.receive).not.toHaveBeenCalled();
        expect(producer.send.mock.calls[0][0].topic).toBe(DEAD_LETTER_TOPIC);
        expect(producer.send.mock.calls[0][0].messages[0].headers['dlq-reason']).toContain(reason);
        expect(inbox.markProcessed).toHaveBeenCalledWith('event-1', TOPIC);
    });

    it('sends a message without ce_id to the dead letter topic without touching the inbox', async () => {
        await handle(message(BODY, headers(BODY, { ce_id: undefined })));

        expect(receiveOrder.receive).not.toHaveBeenCalled();
        expect(producer.send.mock.calls[0][0].messages[0].headers['dlq-reason']).toContain('ce_id');
        expect(inbox.hasProcessed).not.toHaveBeenCalled();
        expect(inbox.markProcessed).not.toHaveBeenCalled();
    });

    it('receives the order inside the trace of the message', async () => {
        let traceId: string | undefined;
        receiveOrder.receive.mockImplementation(async () => {
            traceId = trace.getSpanContext(context.active())?.traceId;
            return { orderId: '6f1c2b8e-0000-4000-8000-000000000001', created: true };
        });

        await handle(message(BODY, headers(BODY, { traceparent: `00-${TRACE_ID}-b7ad6b7169203331-01` })));

        expect(traceId).toBe(TRACE_ID);
    });

    it('sends a message with invalid CloudEvents headers to the dead letter topic', async () => {
        await handle(message(BODY, headers(BODY, { ce_source: '/wrong-service' })));

        expect(receiveOrder.receive).not.toHaveBeenCalled();
        expect(producer.send.mock.calls[0][0].messages[0].headers['dlq-reason']).toContain('ce_source');
        expect(inbox.markProcessed).toHaveBeenCalledWith('event-1', TOPIC);
    });

    it('marks a permanently invalid message only after the DLQ write succeeds', async () => {
        producer.send.mockRejectedValue(new Error('broker unavailable'));

        await expect(handle(message({ ...BODY, marketplace: 'EBAY' }))).rejects.toThrow('broker unavailable');

        expect(inbox.markProcessed).not.toHaveBeenCalled();
    });

    it('rethrows infrastructure failures so Kafka retries the source message', async () => {
        receiveOrder.receive.mockRejectedValue(new Error('database is down'));

        await expect(handle(message(BODY))).rejects.toThrow('database is down');

        expect(producer.send).not.toHaveBeenCalled();
        expect(inbox.markProcessed).not.toHaveBeenCalled();
    });

    it('sends database data exceptions to the DLQ and records the ce_id', async () => {
        receiveOrder.receive.mockRejectedValue(Object.assign(new Error('value out of range'), { code: '22003' }));

        await handle(message(BODY));

        expect(producer.send.mock.calls[0][0].topic).toBe(DEAD_LETTER_TOPIC);
        expect(inbox.markProcessed).toHaveBeenCalledWith('event-1', TOPIC);
    });
});
