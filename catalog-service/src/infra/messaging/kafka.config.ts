import { Consumer, Kafka, Producer } from "kafkajs";

export const configureKafka = (brokers: string[]): { producer: Producer, consumer: Consumer, orderStockConsumer: Consumer } => {
    const kafka = new Kafka({
        clientId: "catalog-service",
        brokers
    });

    // Idempotent and one request in flight: a retried send is neither duplicated nor
    // reordered by the broker. Retries are finite so a send to a dead broker fails and
    // the relay keeps the events pending, instead of holding the outbox locks forever.
    const producer = kafka.producer({ idempotent: true, maxInFlightRequests: 1, retry: { retries: 5 } });
    const consumer = kafka.consumer({ groupId: "catalog-service-group" });
    // Its own group, so a stuck order event does not hold back analysis results, and vice versa.
    const orderStockConsumer = kafka.consumer({ groupId: "catalog-service-order-stock" });

    return { producer, consumer, orderStockConsumer };
}
