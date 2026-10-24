import { Consumer, EachMessagePayload, Producer } from 'kafkajs';
import { Logger } from 'pino';
import { z } from 'zod';
import { PublishApprovedProductPort } from '../../core/listing/port/in/publish-approved-product.port';
import { DomainError } from '../../core/shared/domain/domain.error';
import { headerValue, parseMessage, sendToDeadLetter, UnprocessableMessageError } from './dead-letter';
import { Inbox } from './inbox';

// Contract published by the catalog-service (see docs/eventos.md). The event carries no name, price or
// stock: the gateway reads them from the catalog when it publishes (ADR-0011).
const productApprovedSchema = z.object({
    productId: z.uuid(),
    sku: z.string().trim().min(1),
});

export interface CatalogProductTopics {
    approvedTopic: string;
    deadLetterTopic: string;
}

export class CatalogProductConsumer {

    constructor(
        private readonly publishApprovedProductPort: PublishApprovedProductPort,
        private readonly consumer: Consumer,
        private readonly producer: Producer,
        private readonly inbox: Inbox,
        private readonly topics: CatalogProductTopics,
        private readonly logger: Logger,
    ) {}

    public async start(): Promise<void> {
        await this.consumer.connect();
        await this.consumer.subscribe({ topics: [this.topics.approvedTopic], fromBeginning: true });
        await this.consumer.run({ eachMessage: this.handle });
    }

    // A message that can never succeed (outside the contract, or a product the catalog does not have or did not
    // approve) goes to the dead letter topic. Anything else, such as a catalog that is down, is rethrown and redelivered.
    private handle = async (payload: EachMessagePayload): Promise<void> => {
        const { topic, partition, message } = payload;
        const position = { topic, partition, offset: message.offset };
        const eventId = headerValue(message.headers, 'ce_id');

        if (eventId && await this.inbox.hasProcessed(eventId)) {
            this.logger.info({ ...position, eventId }, 'Catalog event already handled');
            return;
        }

        try {
            await this.dispatch(topic, message.value);
        } catch (err) {
            if (!(err instanceof UnprocessableMessageError || err instanceof DomainError)) {
                throw err;
            }
            this.logger.warn({ ...position, err }, 'Catalog event sent to the dead letter topic');
            await sendToDeadLetter(this.producer, this.topics.deadLetterTopic, payload, err.message);
        }

        if (eventId) {
            await this.inbox.markProcessed(eventId, topic);
        }
    };

    private async dispatch(topic: string, value: Buffer | null): Promise<void> {
        const { productId, sku } = parseMessage(value, productApprovedSchema);

        this.logger.info({ topic, productId, sku }, 'Product approved: publishing its listings');
        await this.publishApprovedProductPort.publish({ productId, sku });
    }

}
