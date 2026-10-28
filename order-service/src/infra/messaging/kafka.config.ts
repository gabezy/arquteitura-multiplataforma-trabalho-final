import { CompressionCodecs, CompressionTypes, Consumer, Kafka, Producer } from "kafkajs";
import SnappyCodec from "kafkajs-snappy";

// The billing-service (franz-go) compresses its batches with Snappy by default, and kafkajs only ships GZIP:
// without this codec the consumer of billing.payment.* crashes on the first message.
CompressionCodecs[CompressionTypes.Snappy] = SnappyCodec;

export interface KafkaClients {
    producer: Producer;
    marketplaceOrderConsumer: Consumer;
    stockResponseConsumer: Consumer;
    billingPaymentConsumer: Consumer;
}

export const configureKafka = (brokers: string[]): KafkaClients => {
    const kafka = new Kafka({
        clientId: "order-service",
        brokers
    });

    // Idempotent and one request in flight: a retried send is neither duplicated nor
    // reordered by the broker. Retries are finite so a send to a dead broker fails and
    // the relay keeps the events pending, instead of holding the outbox locks forever.
    const producer = kafka.producer({ idempotent: true, maxInFlightRequests: 1, retry: { retries: 5 } });
    // One group per source, so a stuck message of one flow does not hold back the others.
    const marketplaceOrderConsumer = kafka.consumer({ groupId: 'order-service-marketplace-orders' });
    const stockResponseConsumer = kafka.consumer({ groupId: 'order-service-stock-response' });
    const billingPaymentConsumer = kafka.consumer({ groupId: 'order-service-billing-payment' });

    return { producer, marketplaceOrderConsumer, stockResponseConsumer, billingPaymentConsumer };
}
