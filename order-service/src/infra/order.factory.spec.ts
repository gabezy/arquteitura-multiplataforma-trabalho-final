import { Knex } from 'knex';
import { Consumer, EachMessagePayload, Producer } from 'kafkajs';
import pino from 'pino';
import { createOrderModule } from './order.factory';

const fakeConsumer = () => ({ connect: jest.fn(), subscribe: jest.fn(), run: jest.fn(), disconnect: jest.fn() });

// A message without ce_id goes to the dead letter topic before the inbox or the database is read.
const withoutEventId = (topic: string): EachMessagePayload => ({
    topic,
    partition: 0,
    message: { key: null, value: Buffer.from('{}'), offset: '0', headers: {} },
} as unknown as EachMessagePayload);

describe('createOrderModule', () => {
    const producer = { send: jest.fn() };
    const kafka = { marketplace: fakeConsumer(), stock: fakeConsumer(), billing: fakeConsumer() };

    const orderModule = () => createOrderModule({
        // Only the inbox write of a dead-lettered message reaches the database here.
        db: (() => ({ insert: () => ({ onConflict: () => ({ ignore: async () => undefined }) }) })) as unknown as Knex,
        producer: producer as unknown as Producer,
        marketplaceOrderKafkaConsumer: kafka.marketplace as unknown as Consumer,
        stockResponseKafkaConsumer: kafka.stock as unknown as Consumer,
        billingPaymentKafkaConsumer: kafka.billing as unknown as Consumer,
        logger: pino({ level: 'silent' }),
    });

    beforeEach(() => {
        jest.resetAllMocks();
    });

    it.each([
        ['marketplaceOrderConsumer', 'marketplace', ['marketplace.order.received.v1'], 'order.marketplace-order.dlq'],
        ['stockResponseConsumer', 'stock', ['catalog.stock.reserved.v1', 'catalog.stock.insufficient.v1'], 'order.stock-response.dlq'],
        ['billingPaymentConsumer', 'billing', ['billing.payment.confirmed.v1', 'billing.payment.failed.v1'], 'order.billing-payment.dlq'],
    ] as const)('wires %s to its own Kafka consumer, topics and dead letter topic', async (name, client, topics, deadLetterTopic) => {
        await orderModule()[name].start();

        expect(kafka[client].connect).toHaveBeenCalled();
        const subscribed = kafka[client].subscribe.mock.calls[0][0];
        expect(subscribed.topics).toEqual(topics);
        expect(subscribed.fromBeginning).toBe(true);

        const { eachMessage } = kafka[client].run.mock.calls[0][0];
        await eachMessage(withoutEventId(topics[0]));
        expect(producer.send).toHaveBeenCalledWith(expect.objectContaining({ topic: deadLetterTopic }));
    });

    // The ce_source check runs before the inbox, so a wrong source reaches the dead letter topic without the database.
    it.each([
        ['marketplaceOrderConsumer', 'marketplace', 'marketplace.order.received.v1', '/marketplace-gateway'],
        ['stockResponseConsumer', 'stock', 'catalog.stock.reserved.v1', '/catalog-service'],
        ['billingPaymentConsumer', 'billing', 'billing.payment.failed.v1', '/billing-service'],
    ] as const)('%s only takes events whose ce_source is that of its producer', async (name, client, topic, source) => {
        await orderModule()[name].start();
        const { eachMessage } = kafka[client].run.mock.calls[0][0];

        await eachMessage({
            topic,
            partition: 0,
            message: {
                key: null,
                value: Buffer.from('{}'),
                offset: '0',
                headers: { ce_specversion: '1.0', ce_id: 'event-1', ce_source: '/somewhere-else', ce_type: topic },
            },
        } as unknown as EachMessagePayload);

        expect(producer.send.mock.calls[0][0].messages[0].headers['dlq-reason']).toBe(`ce_source must be ${source}.`);
    });

    it.each(['marketplaceOrderConsumer', 'stockResponseConsumer', 'billingPaymentConsumer'] as const)('%s disconnects its Kafka consumer', async name => {
        const consumers = { marketplaceOrderConsumer: kafka.marketplace, stockResponseConsumer: kafka.stock, billingPaymentConsumer: kafka.billing };

        await orderModule()[name].disconnect();

        expect(consumers[name].disconnect).toHaveBeenCalled();
    });
});
