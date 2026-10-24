import { context, propagation, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { Consumer, EachMessagePayload, IHeaders, Producer } from 'kafkajs';
import pino from 'pino';
import { InvalidOrderError, OrderNotFoundError, OrderStateConflictError } from '../../core/order/model/order.errors';
import { ApplyPaymentResultPort } from '../../core/order/port/in/apply-payment-result.port';
import { ApplyStockOutcomePort } from '../../core/order/port/in/apply-stock-outcome.port';
import { ConcurrentModificationError } from '../persistence/concurrent-modification.error';
import { billingPaymentTopics } from './billing-payment.topics';
import { Inbox } from './inbox';
import { OrderOutcomeConsumer } from './order-outcome.consumer';
import { stockResponseTopics } from './stock-response.topics';

const ORDER_ID = '6f1c2b8e-0000-4000-8000-000000000001';
const INVOICE_ID = 'a3c1d5e2-7b4f-4c8a-9e10-2d3f4a5b6c7d';
const OTHER_ID = '7c4d1e90-2b7f-4f0e-9a3c-51c0f4d8e6a2';
const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';

const RESERVED = 'catalog.stock.reserved.v1';
const INSUFFICIENT = 'catalog.stock.insufficient.v1';
const PAID = 'billing.payment.confirmed.v1';
const FAILED = 'billing.payment.failed.v1';
const STOCK_DLQ = 'order.stock-response.dlq';
const PAYMENT_DLQ = 'order.billing-payment.dlq';

const RESERVED_BODY = { orderId: ORDER_ID, items: [{ sku: 'NB-001', quantity: 1 }] };
const INSUFFICIENT_BODY = { orderId: ORDER_ID, items: [{ sku: 'NB-001', requested: 2, available: 1 }] };
const PAID_BODY = { invoiceId: INVOICE_ID, orderId: ORDER_ID, amount: 4500, pspTransactionId: 'ch_paid_1', paidAt: '2026-10-28T13:05:06Z' };
const FAILED_BODY = { invoiceId: INVOICE_ID, orderId: ORDER_ID, amount: 4500, reason: 'INSUFFICIENT_FUNDS', failedAt: '2026-10-28T13:05:06Z' };

const SOURCES: Record<string, string> = {
    [RESERVED]: '/catalog-service', [INSUFFICIENT]: '/catalog-service', [PAID]: '/billing-service', [FAILED]: '/billing-service',
};
const SUBJECTS: Record<string, string> = { [RESERVED]: ORDER_ID, [INSUFFICIENT]: ORDER_ID, [PAID]: INVOICE_ID, [FAILED]: INVOICE_ID };

const headers = (topic: string, overrides: IHeaders = {}): IHeaders => ({
    ce_specversion: '1.0',
    ce_id: 'event-1',
    ce_source: SOURCES[topic],
    ce_type: topic,
    ce_subject: SUBJECTS[topic],
    ce_time: '2026-10-28T13:05:02.123456789Z',
    'content-type': 'application/json',
    ...overrides,
});

const message = (topic: string, value: unknown, overrides: IHeaders = {}): EachMessagePayload => ({
    topic,
    partition: 1,
    message: {
        key: Buffer.from(SUBJECTS[topic]),
        value: value === null ? null : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)),
        offset: '9',
        headers: headers(topic, overrides),
    },
} as unknown as EachMessagePayload);

describe('OrderOutcomeConsumer', () => {
    const kafkaConsumer = { connect: jest.fn(), subscribe: jest.fn(), run: jest.fn(), disconnect: jest.fn() };
    const producer = { send: jest.fn() };
    const inbox: jest.Mocked<Inbox> = { hasProcessed: jest.fn(), markProcessed: jest.fn() };
    const stockPort: jest.Mocked<ApplyStockOutcomePort> = { applyStockReserved: jest.fn(), applyStockInsufficient: jest.fn() };
    const paymentPort: jest.Mocked<ApplyPaymentResultPort> = { applyPaymentConfirmed: jest.fn(), applyPaymentFailed: jest.fn() };
    const logger = pino({ level: 'silent' });
    let warn: jest.SpyInstance;

    const consumerFor = (group: 'stock' | 'payment') => new OrderOutcomeConsumer({
        consumer: kafkaConsumer as unknown as Consumer,
        producer: producer as unknown as Producer,
        inbox,
        logger,
        ...(group === 'stock'
            ? { source: '/catalog-service', deadLetterTopic: STOCK_DLQ, topics: stockResponseTopics(stockPort) }
            : { source: '/billing-service', deadLetterTopic: PAYMENT_DLQ, topics: billingPaymentTopics(paymentPort) }),
    });

    const handle = async (payload: EachMessagePayload): Promise<void> => {
        await consumerFor(payload.topic.startsWith('catalog.') ? 'stock' : 'payment').start();
        const { eachMessage } = kafkaConsumer.run.mock.calls[0][0];
        await eachMessage(payload);
    };

    const deadLettered = () => producer.send.mock.calls.map(([record]) => record);
    const appliedNothing = () => {
        expect(stockPort.applyStockReserved).not.toHaveBeenCalled();
        expect(stockPort.applyStockInsufficient).not.toHaveBeenCalled();
        expect(paymentPort.applyPaymentConfirmed).not.toHaveBeenCalled();
        expect(paymentPort.applyPaymentFailed).not.toHaveBeenCalled();
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
        warn = jest.spyOn(logger, 'warn');
    });

    afterEach(() => {
        warn.mockRestore();
    });

    it.each([
        ['stock', [RESERVED, INSUFFICIENT]],
        ['payment', [PAID, FAILED]],
    ] as const)('subscribes the %s group to its two topics from the beginning', async (group, topics) => {
        await consumerFor(group).start();

        expect(kafkaConsumer.subscribe).toHaveBeenCalledWith({ topics, fromBeginning: true });
    });

    describe('applies each outcome to the order', () => {
        it.each([
            [RESERVED, RESERVED_BODY, () => stockPort.applyStockReserved],
            [INSUFFICIENT, INSUFFICIENT_BODY, () => stockPort.applyStockInsufficient],
            [PAID, PAID_BODY, () => paymentPort.applyPaymentConfirmed],
            [FAILED, FAILED_BODY, () => paymentPort.applyPaymentFailed],
        ])('%s', async (topic, body, port) => {
            await handle(message(topic, body));

            expect(port()).toHaveBeenCalledTimes(1);
            expect(port()).toHaveBeenCalledWith({ orderId: ORDER_ID });
            expect(inbox.markProcessed).toHaveBeenCalledWith('event-1', topic);
            expect(producer.send).not.toHaveBeenCalled();
        });
    });

    it('processes a message with fields unknown to the contract', async () => {
        await handle(message(RESERVED, { ...RESERVED_BODY, warehouse: 'SP-1' }));

        expect(stockPort.applyStockReserved).toHaveBeenCalledWith({ orderId: ORDER_ID });
    });

    it('processes a confirmed payment without reason', async () => {
        await handle(message(PAID, PAID_BODY));

        expect(paymentPort.applyPaymentConfirmed).toHaveBeenCalledWith({ orderId: ORDER_ID });
        expect(producer.send).not.toHaveBeenCalled();
    });

    it('skips a ce_id already in the inbox', async () => {
        inbox.hasProcessed.mockResolvedValue(true);

        await handle(message(RESERVED, RESERVED_BODY));

        expect(inbox.hasProcessed).toHaveBeenCalledWith('event-1');
        appliedNothing();
        expect(inbox.markProcessed).not.toHaveBeenCalled();
        expect(producer.send).not.toHaveBeenCalled();
    });

    describe('skips with a warning, without the dead letter topic, an outcome the order does not take', () => {
        it.each([
            ['contradicts the order', RESERVED, RESERVED_BODY, () => stockPort.applyStockReserved, new OrderStateConflictError(ORDER_ID, 'CANCELLED (OUT_OF_STOCK)', 'be confirmed')],
            ['names no order', RESERVED, RESERVED_BODY, () => stockPort.applyStockReserved, new OrderNotFoundError(ORDER_ID)],
            ['contradicts the order', PAID, PAID_BODY, () => paymentPort.applyPaymentConfirmed, new OrderStateConflictError(ORDER_ID, 'RECEIVED', 'be paid')],
            ['contradicts the order', FAILED, FAILED_BODY, () => paymentPort.applyPaymentFailed, new OrderStateConflictError(ORDER_ID, 'PAID', 'be cancelled for a failed payment')],
            ['names no order', FAILED, FAILED_BODY, () => paymentPort.applyPaymentFailed, new OrderNotFoundError(ORDER_ID)],
        ])('when it %s (%s)', async (_, topic, body, port, error) => {
            port().mockRejectedValue(error);

            await handle(message(topic, body));

            expect(producer.send).not.toHaveBeenCalled();
            expect(inbox.markProcessed).toHaveBeenCalledWith('event-1', topic);
            expect(warn).toHaveBeenCalledWith(
                expect.objectContaining({ topic, orderId: ORDER_ID, reason: error.message }),
                'Order outcome skipped',
            );
        });
    });

    describe('sends a message out of contract to the dead letter topic of its group', () => {
        it('with the original key, value and headers plus the dlq-* headers, and marks its ce_id', async () => {
            const payload = message(RESERVED, { orderId: 'x', items: [] });

            await handle(payload);

            expect(deadLettered()).toEqual([{
                topic: STOCK_DLQ,
                messages: [{
                    key: payload.message.key,
                    value: payload.message.value,
                    headers: {
                        ...payload.message.headers,
                        'dlq-original-topic': RESERVED,
                        'dlq-original-partition': '1',
                        'dlq-original-offset': '9',
                        'dlq-reason': expect.stringContaining('orderId'),
                    },
                }],
            }]);
            expect(inbox.markProcessed).toHaveBeenCalledWith('event-1', RESERVED);
            expect(warn).toHaveBeenCalledWith(
                expect.objectContaining({ topic: RESERVED, partition: 1, offset: '9', reason: expect.stringContaining('orderId') }),
                'Order outcome sent to the dead letter topic',
            );
            appliedNothing();
        });

        it.each([
            ['an empty value', RESERVED, null],
            ['invalid JSON', RESERVED, '{"orderId":'],
            ['an orderId that is not a UUID', INSUFFICIENT, { ...INSUFFICIENT_BODY, orderId: 'x' }],
            ['no items', RESERVED, { orderId: ORDER_ID }],
            ['items that are not an array', RESERVED, { orderId: ORDER_ID, items: {} }],
            ['empty items', INSUFFICIENT, { orderId: ORDER_ID, items: [] }],
        ])('stock answer with %s', async (_, topic, body) => {
            await handle(message(topic, body));

            expect(deadLettered().map(record => record.topic)).toEqual([STOCK_DLQ]);
            appliedNothing();
        });

        it.each([
            ['an empty value', PAID, null],
            ['an orderId that is not a UUID', PAID, { ...PAID_BODY, orderId: 'x' }],
            ['no invoiceId', FAILED, { ...FAILED_BODY, invoiceId: undefined }],
            ['an invoiceId that is not a UUID', PAID, { ...PAID_BODY, invoiceId: 'x' }],
            ['a failure without reason', FAILED, { ...FAILED_BODY, reason: undefined }],
            ['a failure whose reason is not a string', FAILED, { ...FAILED_BODY, reason: 3 }],
            ['a failure with a blank reason', FAILED, { ...FAILED_BODY, reason: '  ' }],
        ])('payment result with %s', async (_, topic, body) => {
            await handle(message(topic, body));

            expect(deadLettered().map(record => record.topic)).toEqual([PAYMENT_DLQ]);
            appliedNothing();
        });

        it.each([
            ['ce_specversion is not 1.0', RESERVED, { ce_specversion: '0.3' }],
            ['ce_source is another service', RESERVED, { ce_source: '/billing-service' }],
            ['ce_source is another service', PAID, { ce_source: '/catalog-service' }],
            ['ce_type is not the topic', INSUFFICIENT, { ce_type: RESERVED }],
            ['ce_subject is missing', RESERVED, { ce_subject: undefined }],
            ['ce_subject is not the order', RESERVED, { ce_subject: OTHER_ID }],
            ['ce_subject is the order instead of the invoice', FAILED, { ce_subject: ORDER_ID }],
            ['ce_time is not ISO-8601', RESERVED, { ce_time: 'ontem' }],
            ['content-type is not JSON', PAID, { 'content-type': 'text/plain' }],
        ])('when %s (%s), marking its ce_id', async (_, topic, overrides) => {
            const body = { [RESERVED]: RESERVED_BODY, [INSUFFICIENT]: INSUFFICIENT_BODY, [PAID]: PAID_BODY, [FAILED]: FAILED_BODY }[topic];

            await handle(message(topic, body, overrides));

            expect(deadLettered().map(record => record.topic)).toEqual([topic.startsWith('catalog.') ? STOCK_DLQ : PAYMENT_DLQ]);
            expect(inbox.markProcessed).toHaveBeenCalledWith('event-1', topic);
            appliedNothing();
        });

        it.each([
            ['missing', undefined],
            ['not printable ASCII', 'evento-ç'],
            ['longer than 200 characters', 'e'.repeat(201)],
        ])('when ce_id is %s, without reading or writing the inbox', async (_, ceId) => {
            await handle(message(RESERVED, RESERVED_BODY, { ce_id: ceId }));

            expect(deadLettered().map(record => record.topic)).toEqual([STOCK_DLQ]);
            expect(inbox.hasProcessed).not.toHaveBeenCalled();
            expect(inbox.markProcessed).not.toHaveBeenCalled();
            appliedNothing();
        });

        it('when the domain refuses the data', async () => {
            paymentPort.applyPaymentFailed.mockRejectedValue(new InvalidOrderError('Order id must be a UUID.'));

            await handle(message(FAILED, FAILED_BODY));

            expect(deadLettered().map(record => record.topic)).toEqual([PAYMENT_DLQ]);
        });

        it('when Postgres refuses the values (SQLSTATE class 22)', async () => {
            stockPort.applyStockReserved.mockRejectedValue(Object.assign(new Error('invalid input syntax'), { code: '22P02' }));

            await handle(message(RESERVED, RESERVED_BODY));

            expect(deadLettered().map(record => record.topic)).toEqual([STOCK_DLQ]);
            expect(inbox.markProcessed).toHaveBeenCalledWith('event-1', RESERVED);
        });
    });

    describe('rethrows so Kafka redelivers, without the dead letter topic or the inbox', () => {
        it.each([
            ['the database is down', new Error('connect ECONNREFUSED')],
            ['the order changed since it was read', new ConcurrentModificationError('version 3 is stale')],
        ])('when %s', async (_, error) => {
            paymentPort.applyPaymentConfirmed.mockRejectedValue(error);

            await expect(handle(message(PAID, PAID_BODY))).rejects.toBe(error);

            expect(producer.send).not.toHaveBeenCalled();
            expect(inbox.markProcessed).not.toHaveBeenCalled();
        });
    });

    it('applies the outcome inside the trace of the message', async () => {
        let traceId: string | undefined;
        stockPort.applyStockInsufficient.mockImplementation(async () => {
            traceId = trace.getSpanContext(context.active())?.traceId;
        });

        await handle(message(INSUFFICIENT, INSUFFICIENT_BODY, { traceparent: `00-${TRACE_ID}-b7ad6b7169203331-01` }));

        expect(traceId).toBe(TRACE_ID);
    });
});
