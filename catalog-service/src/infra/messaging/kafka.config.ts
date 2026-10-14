import { Consumer, Kafka, Producer } from "kafkajs";

export const configureKafka = (): { producer: Producer, consumer: Consumer } => {
    const kafka = new Kafka({
        clientId: "catalog-service",
        brokers: ["localhost:9092"]
    });

    const producer = kafka.producer();
    const consumer = kafka.consumer({ groupId: "catalog-service-group" });
    
    return { producer, consumer };
}
