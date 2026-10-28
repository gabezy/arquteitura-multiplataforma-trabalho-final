import { Consumer, EachMessagePayload, Producer } from "kafkajs";
import { Logger } from "pino";
import { z } from "zod";
import { ReleaseStockPort } from "../../core/stock/port/in/release-stock.port";
import { ReserveStockPort } from "../../core/stock/port/in/reserve-stock.port";
import { DomainError } from "../../core/shared/domain/domain.error";
import { parseMessage, sendToDeadLetter, UnprocessableMessageError } from "./dead-letter";

// Contracts published by the order-service (provisional until it exists, see #8).
// A malformed SKU is still a valid line: the order gets an "insufficient" answer
// instead of waiting forever for one.
const orderPlacedSchema = z.object({
    orderId: z.uuid(),
    items: z.array(z.object({
        sku: z.string().min(1),
        quantity: z.number().int().positive(),
    })).min(1),
});

const orderCancelledSchema = z.object({
    orderId: z.uuid(),
    reason: z.string().optional(),
});

export interface OrderStockTopics {
    placedTopic: string;
    cancelledTopic: string;
    deadLetterTopic: string;
}

export class OrderStockConsumer {

    constructor(
        private readonly reserveStockPort: ReserveStockPort,
        private readonly releaseStockPort: ReleaseStockPort,
        private readonly consumer: Consumer,
        private readonly producer: Producer,
        private readonly topics: OrderStockTopics,
        private readonly logger: Logger
    ) {}

    public async start(): Promise<void> {
        await this.consumer.connect();
        await this.consumer.subscribe({ topics: [this.topics.placedTopic, this.topics.cancelledTopic], fromBeginning: true });
        await this.consumer.run({ eachMessage: this.handle });
    }

    private handle = async (payload: EachMessagePayload): Promise<void> => {
        const { topic, partition, message } = payload;
        const position = { topic, partition, offset: message.offset };
        this.logger.info(position, 'Order event received');

        try {
            await this.dispatch(topic, message.value);
        } catch (err) {
            if (!(err instanceof UnprocessableMessageError || err instanceof DomainError)) {
                throw err;
            }
            this.logger.warn({ ...position, err }, 'Order event sent to the dead letter topic');
            await sendToDeadLetter(this.producer, this.topics.deadLetterTopic, payload, err.message);
        }
    };

    private async dispatch(topic: string, value: Buffer | null): Promise<void> {
        if (topic === this.topics.placedTopic) {
            const { orderId, items } = parseMessage(value, orderPlacedSchema);
            await this.reserveStockPort.reserve({ orderId, items: items.map(({ sku, quantity }) => ({ sku, quantity })) });
            return;
        }

        const { orderId, reason } = parseMessage(value, orderCancelledSchema);
        this.logger.info({ orderId, reason }, 'Releasing the stock of a cancelled order');
        await this.releaseStockPort.release({ orderId });
    }

}
