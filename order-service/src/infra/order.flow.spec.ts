import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Consumer, EachMessagePayload, Producer } from 'kafkajs';
import knex, { Knex } from 'knex';
import pino from 'pino';
import request from 'supertest';
import { Express } from 'express';
import { createApp } from './http/app';
import { createOrderModule, OrderModule } from './order.factory';
import { createMigrationSource } from './persistence/migration-source';

const POSTGRES_IMAGE = 'postgres:18-alpine';
const CONTAINER_STARTUP_MS = 60_000;
const SALE_DAY = '2026-10-28';

const SOURCES: Record<string, string> = {
    'marketplace.order.received.v1': '/marketplace-gateway',
    'catalog.stock.reserved.v1': '/catalog-service',
    'catalog.stock.insufficient.v1': '/catalog-service',
    'billing.payment.confirmed.v1': '/billing-service',
    'billing.payment.failed.v1': '/billing-service',
};

interface OutboxRow {
    event_type: string;
    aggregate_id: string;
    payload: Record<string, unknown>;
}

const fakeConsumer = () => ({ connect: jest.fn(), subscribe: jest.fn(), run: jest.fn(), disconnect: jest.fn() });

// The whole life cycle of ADR-0004 through the real consumers, repository and outbox on Postgres.
describe('order flow', () => {
    let container: StartedPostgreSqlContainer;
    let db: Knex;
    let app: Express;
    const kafka = { marketplace: fakeConsumer(), stock: fakeConsumer(), billing: fakeConsumer() };
    const producer = { send: jest.fn() };
    let eventSequence = 0;

    const deliver = async (client: keyof typeof kafka, topic: string, subject: string, data: unknown): Promise<void> => {
        const { eachMessage } = kafka[client].run.mock.calls[0][0];
        await eachMessage({
            topic,
            partition: 0,
            message: {
                key: Buffer.from(subject),
                value: Buffer.from(JSON.stringify(data)),
                offset: String(eventSequence),
                headers: {
                    ce_specversion: '1.0',
                    ce_id: `event-${++eventSequence}`,
                    ce_source: SOURCES[topic],
                    ce_type: topic,
                    ce_subject: subject,
                    ce_time: `${SALE_DAY}T13:05:01Z`,
                    'content-type': 'application/json',
                },
            },
        } as unknown as EachMessagePayload);
    };

    // Returns the id the order-service gave to the marketplace order.
    const receive = async (marketplace: string, externalOrderId: string, sku: string, quantity: number, unitPrice: number): Promise<string> => {
        await deliver('marketplace', 'marketplace.order.received.v1', `${marketplace}:${externalOrderId}`, {
            marketplace,
            externalOrderId,
            items: [{ sku, quantity, unitPrice }],
            total: quantity * unitPrice,
            orderedAt: `${SALE_DAY}T13:05:00Z`,
        });
        const placed = (await outbox('order.order.placed.v1')).find(row => row.payload.externalOrderId === externalOrderId);
        return placed!.aggregate_id;
    };

    const reserved = (orderId: string) => deliver('stock', 'catalog.stock.reserved.v1', orderId, { orderId, items: [{ sku: 'X', quantity: 1 }] });
    const insufficient = (orderId: string) =>
        deliver('stock', 'catalog.stock.insufficient.v1', orderId, { orderId, items: [{ sku: 'X', requested: 1, available: 0 }] });
    const invoiceOf = (orderId: string) => `${orderId.slice(0, -1)}f`;
    const paid = (orderId: string) => deliver('billing', 'billing.payment.confirmed.v1', invoiceOf(orderId), {
        invoiceId: invoiceOf(orderId), orderId, amount: 1, pspTransactionId: 'ch_paid', paidAt: `${SALE_DAY}T13:05:06Z`,
    });
    const failed = (orderId: string) => deliver('billing', 'billing.payment.failed.v1', invoiceOf(orderId), {
        invoiceId: invoiceOf(orderId), orderId, amount: 1, reason: 'INSUFFICIENT_FUNDS', failedAt: `${SALE_DAY}T13:05:06Z`,
    });

    const outbox = async (eventType?: string): Promise<OutboxRow[]> => {
        const rows = await db('outbox').select('event_type', 'aggregate_id', 'payload').orderBy('sequence')
            .modify(query => { if (eventType) query.where({ event_type: eventType }); });
        return rows.map((row: { event_type: string; aggregate_id: string; payload: unknown }) => ({ ...row, payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload as Record<string, unknown> }));
    };
    const order = async (id: string) => (await request(app).get(`/orders/${id}`).expect(200)).body;

    beforeAll(async () => {
        container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
        db = knex({ client: 'pg', connection: container.getConnectionUri() });
        await db.migrate.latest({ migrationSource: createMigrationSource() });

        const logger = pino({ level: 'silent' });
        const module: OrderModule = createOrderModule({
            db,
            producer: producer as unknown as Producer,
            marketplaceOrderKafkaConsumer: kafka.marketplace as unknown as Consumer,
            stockResponseKafkaConsumer: kafka.stock as unknown as Consumer,
            billingPaymentKafkaConsumer: kafka.billing as unknown as Consumer,
            logger,
        });
        await module.marketplaceOrderConsumer.start();
        await module.stockResponseConsumer.start();
        await module.billingPaymentConsumer.start();
        app = createApp({ logger, checkDatabase: async () => undefined, orderController: module.orderController, salesReportController: module.salesReportController });
    }, CONTAINER_STARTUP_MS);

    afterAll(async () => {
        await db?.destroy();
        await container?.stop();
    });

    it('takes each order to its final state with the events of the contract, and reports the sales', async () => {
        const iphone = await receive('MERCADO_LIVRE', 'ML-2000001', 'IPHONE-15', 1, 15000);
        const refused = await receive('AMAZON', 'AMZ-1000002', 'MON-002', 2, 18500);
        const noStock = await receive('SHOPEE', 'SHP-3000003', 'NB-001', 1, 4500);

        await reserved(iphone);
        await paid(iphone);
        await reserved(refused);
        await failed(refused);
        await insufficient(noStock);

        expect(await order(iphone)).toEqual(expect.objectContaining({ status: 'PAID', cancellationReason: null, total: 15000 }));
        expect(await order(refused)).toEqual(expect.objectContaining({ status: 'CANCELLED', cancellationReason: 'PAYMENT_FAILED' }));
        expect(await order(noStock)).toEqual(expect.objectContaining({ status: 'CANCELLED', cancellationReason: 'OUT_OF_STOCK' }));

        const confirmed = await outbox('order.order.confirmed.v1');
        expect(confirmed.map(row => row.aggregate_id)).toEqual([iphone, refused]);
        expect(confirmed[0].payload).toEqual({
            orderId: iphone,
            marketplace: 'MERCADO_LIVRE',
            externalOrderId: 'ML-2000001',
            items: [{ sku: 'IPHONE-15', quantity: 1, unitPrice: 15000 }],
            total: 15000,
            confirmedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
        });

        const cancelled = await outbox('order.order.cancelled.v1');
        expect(cancelled.map(row => row.payload)).toEqual([
            { orderId: refused, reason: 'PAYMENT_FAILED', marketplace: 'AMAZON', externalOrderId: 'AMZ-1000002' },
            { orderId: noStock, reason: 'OUT_OF_STOCK', marketplace: 'SHOPEE', externalOrderId: 'SHP-3000003' },
        ]);
        expect(producer.send).not.toHaveBeenCalled();

        const report = (await request(app).get(`/reports/sales-by-marketplace?from=${SALE_DAY}&to=${SALE_DAY}`).expect(200)).body;
        expect(report.marketplaces).toEqual(expect.arrayContaining([
            expect.objectContaining({ marketplace: 'MERCADO_LIVRE', orders: 1, units: 1, totalAmount: 15000 }),
        ]));
        for (const marketplace of ['AMAZON', 'SHOPEE']) {
            expect(report.marketplaces.find((row: { marketplace: string }) => row.marketplace === marketplace) ?? { orders: 0 })
                .toEqual(expect.objectContaining({ orders: 0 }));
        }
    });

    it('counts a re-published marketplace order once and ignores late or contradicting outcomes', async () => {
        const orderId = await receive('MERCADO_LIVRE', 'ML-2000009', 'IPHONE-15', 1, 15000);
        await receive('MERCADO_LIVRE', 'ML-2000009', 'IPHONE-15', 1, 15000);
        await reserved(orderId);
        await paid(orderId);
        const eventsBefore = await outbox();

        await reserved(orderId);
        await insufficient(orderId);
        await failed(orderId);

        expect((await outbox('order.order.placed.v1')).filter(row => row.aggregate_id === orderId)).toHaveLength(1);
        expect(await order(orderId)).toEqual(expect.objectContaining({ status: 'PAID' }));
        expect(await outbox()).toEqual(eventsBefore);
        expect(producer.send).not.toHaveBeenCalled();
    });
});
