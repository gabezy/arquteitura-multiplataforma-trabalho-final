import { Consumer, EachMessagePayload, Producer } from 'kafkajs';
import { Logger } from 'pino';
import { z } from 'zod';
import { MARKETPLACES } from '../../core/marketplace/model/marketplace';
import { MarketplaceRejectedError } from '../../core/marketplace/model/marketplace.errors';
import { DomainError } from '../../core/shared/domain/domain.error';
import { CancelMarketplaceOrderPort } from '../../core/order/port/in/cancel-marketplace-order.port';
import { headerValue, parseMessage, sendToDeadLetter, UnprocessableMessageError } from './dead-letter';
import { Inbox } from './inbox';

// Contract published by the order-service (see docs/eventos.md). The gateway cancels the order at the
// marketplace, so it needs marketplace and externalOrderId, which the catalog still lists as optional.
const orderCancelledSchema = z.object({
    orderId: z.uuid(),
    reason: z.string().optional(),
    marketplace: z.enum(MARKETPLACES),
    externalOrderId: z.string().min(1),
});

export interface OrderCancelledTopics {
    topic: string;
    deadLetterTopic: string;
}

export class OrderCancelledConsumer {

    constructor(
        private readonly cancelMarketplaceOrderPort: CancelMarketplaceOrderPort,
        private readonly consumer: Consumer,
        private readonly producer: Producer,
        private readonly inbox: Inbox,
        private readonly topics: OrderCancelledTopics,
        private readonly logger: Logger,
    ) {}

    public async start(): Promise<void> {
        await this.consumer.connect();
        await this.consumer.subscribe({ topics: [this.topics.topic], fromBeginning: true });
        await this.consumer.run({ eachMessage: this.handle });
    }

    // A message that can never succeed (outside the contract, or refused by the marketplace) goes to the dead
    // letter topic. Anything else, such as a marketplace that is down, is rethrown and redelivered.
    private handle = async (payload: EachMessagePayload): Promise<void> => {
        const { topic, partition, message } = payload;
        const position = { topic, partition, offset: message.offset };
        const eventId = headerValue(message.headers, 'ce_id');

        if (eventId && await this.inbox.hasProcessed(eventId)) {
            this.logger.info({ ...position, eventId }, 'Order cancellation already handled');
            return;
        }

        try {
            const { orderId, marketplace, externalOrderId, reason } = parseMessage(message.value, orderCancelledSchema);
            await this.cancelMarketplaceOrderPort.cancel({ marketplace, externalOrderId, reason });
            this.logger.info({ ...position, orderId, marketplace, externalOrderId, reason }, 'Order cancelled at the marketplace');
        } catch (err) {
            if (!(err instanceof UnprocessableMessageError || err instanceof DomainError || err instanceof MarketplaceRejectedError)) {
                throw err;
            }
            this.logger.warn({ ...position, err }, 'Order cancellation sent to the dead letter topic');
            await sendToDeadLetter(this.producer, this.topics.deadLetterTopic, payload, err.message);
        }

        if (eventId) {
            await this.inbox.markProcessed(eventId, topic);
        }
    };

}
