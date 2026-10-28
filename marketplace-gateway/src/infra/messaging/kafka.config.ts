import { Consumer, Kafka, Producer } from "kafkajs";

export const configureKafka = (brokers: string[]): { producer: Producer, catalogProductConsumer: Consumer, orderCancelledConsumer: Consumer } => {
    const kafka = new Kafka({
        clientId: "marketplace-gateway",
        brokers
    });

    // Idempotent and one request in flight: a retried send is neither duplicated nor
    // reordered by the broker. Retries are finite so a send to a dead broker fails and
    // the relay keeps the events pending, instead of holding the outbox locks forever.
    const producer = kafka.producer({ idempotent: true, maxInFlightRequests: 1, retry: { retries: 5 } });
    // One group per kind of input, so a stuck message of one does not hold back the others.
    const catalogProductConsumer = kafka.consumer({ groupId: "marketplace-gateway-catalog-product" });
    const orderCancelledConsumer = kafka.consumer({ groupId: "marketplace-gateway-order-cancelled" });

    return { producer, catalogProductConsumer, orderCancelledConsumer };
}
