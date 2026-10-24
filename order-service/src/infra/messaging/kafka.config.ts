import { Consumer, Kafka, Producer } from "kafkajs";

export const configureKafka = (brokers: string[]): { producer: Producer, marketplaceOrderConsumer: Consumer } => {
    const kafka = new Kafka({
        clientId: "order-service",
        brokers
    });

    // Idempotent and one request in flight: a retried send is neither duplicated nor
    // reordered by the broker. Retries are finite so a send to a dead broker fails and
    // the relay keeps the events pending, instead of holding the outbox locks forever.
    const producer = kafka.producer({ idempotent: true, maxInFlightRequests: 1, retry: { retries: 5 } });
    // One group per source topic, so each dead letter topic maps to one group (docs/eventos.md).
    const marketplaceOrderConsumer = kafka.consumer({ groupId: "order-service-marketplace-orders" });

    return { producer, marketplaceOrderConsumer };
}
