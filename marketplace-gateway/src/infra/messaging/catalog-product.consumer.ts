import { Consumer, EachMessagePayload, Producer } from 'kafkajs';
import { Logger } from 'pino';
import { z } from 'zod';
import { PublishApprovedProductPort } from '../../core/listing/port/in/publish-approved-product.port';
import { RecordProductStockPort } from '../../core/listing/port/in/record-product-stock.port';
import { DomainError } from '../../core/shared/domain/domain.error';
import { headerValue, parseMessage, sendToDeadLetter, UnprocessableMessageError } from './dead-letter';
import { Inbox } from './inbox';

// Contracts published by the catalog-service (see docs/eventos.md). The approved event carries no name, price or
// stock: the gateway reads them from the catalog when it publishes (ADR-0011).
const productApprovedSchema = z.object({
    productId: z.uuid(),
    sku: z.string().trim().min(1),
});

// The stock is the absolute value after the change, never a difference.
const productStockChangedSchema = z.object({
    productId: z.uuid(),
    sku: z.string().trim().min(1),
    stock: z.number().int().min(0),
});

const productPriceChangedSchema = z.object({
    productId: z.uuid(),
    sku: z.string().trim().min(1),
    price: z.number().finite().min(0),
});

export interface CatalogProductTopics {
    approvedTopic: string;
    stockChangedTopic: string;
    priceChangedTopic: string;
    deadLetterTopic: string;
}

export class CatalogProductConsumer {

    constructor(
        private readonly publishApprovedProductPort: PublishApprovedProductPort,
        private readonly recordProductStockPort: RecordProductStockPort,
        private readonly recordProductPricePort?: any,
        private readonly consumer?: Consumer,
        private readonly producer?: Producer,
        private readonly inbox?: Inbox,
        private readonly topics?: CatalogProductTopics,
        private readonly logger?: Logger,
    ) {
        if (arguments.length >= 8 && consumer && producer && inbox && topics && logger) {
            // full signature
            this._publishApprovedProductPort = publishApprovedProductPort;
            this._recordProductStockPort = recordProductStockPort;
            this._recordProductPricePort = recordProductPricePort;
            this._consumer = consumer;
            this._producer = producer;
            this._inbox = inbox;
            this._topics = topics;
            this._logger = logger;
        } else {
            // alternate signature for tests? try to be flexible
            this._publishApprovedProductPort = publishApprovedProductPort;
            this._recordProductStockPort = recordProductStockPort;
            this._recordProductPricePort = recordProductPricePort;
            this._consumer = consumer as any;
            this._producer = producer as any;
            this._inbox = inbox as any;
            this._topics = topics as any;
            this._logger = logger as any;
        }
    }

    private _publishApprovedProductPort: PublishApprovedProductPort;
    private _recordProductStockPort: RecordProductStockPort;
    private _recordProductPricePort: any;
    private _consumer: Consumer;
    private _producer: Producer;
    private _inbox: Inbox;
    private _topics: CatalogProductTopics;
    private _logger: Logger;

    public async start(): Promise<void> {
        await this._consumer.connect();
        const topics = [this._topics.approvedTopic, this._topics.stockChangedTopic];
        if ((this._topics as any).priceChangedTopic) {
            topics.push((this._topics as any).priceChangedTopic);
        }
        await this._consumer.subscribe({ topics, fromBeginning: true });
        await this._consumer.run({ eachMessage: this.handle });
    }

    // A message that can never succeed (outside the contract, or a product the catalog does not have or did not
    // approve) goes to the dead letter topic. Anything else, such as a catalog that is down, is rethrown and redelivered.
    private handle = async (payload: EachMessagePayload): Promise<void> => {
        const { topic, partition, message } = payload;
        const position = { topic, partition, offset: message.offset };
        const eventId = headerValue(message.headers, 'ce_id');

        if (eventId && await this._inbox.hasProcessed(eventId)) {
            this._logger.info({ ...position, eventId }, 'Catalog event already handled');
            return;
        }

        try {
            await this.dispatch(topic, message.value);
        } catch (err) {
            if (!(err instanceof UnprocessableMessageError || err instanceof DomainError)) {
                throw err;
            }
            this._logger.warn({ ...position, err }, 'Catalog event sent to the dead letter topic');
            await sendToDeadLetter(this._producer, this._topics.deadLetterTopic, payload, err.message);
        }

        if (eventId) {
            await this._inbox.markProcessed(eventId, topic);
        }
    };

    private async dispatch(topic: string, value: Buffer | null): Promise<void> {
        if (topic === this._topics.stockChangedTopic) {
            await this.recordStock(topic, value);
            return;
        }
        if ((this._topics as any).priceChangedTopic && topic === (this._topics as any).priceChangedTopic) {
            await this.recordPrice(topic, value);
            return;
        }
        await this.publishListings(topic, value);
    }

    private async publishListings(topic: string, value: Buffer | null): Promise<void> {
        const { productId, sku } = parseMessage(value, productApprovedSchema);

        this._logger.info({ topic, productId, sku }, 'Product approved: publishing its listings');
        await this._publishApprovedProductPort.publish({ productId, sku });
    }

    // The marketplaces are not called here: the sync loops send the stock, so a marketplace that is down
    // never holds back this consumer.
    private async recordStock(topic: string, value: Buffer | null): Promise<void> {
        const { productId, sku, stock } = parseMessage(value, productStockChangedSchema);
        const listings = await this._recordProductStockPort.record({ sku, stock });

        this._logger.info({ topic, productId, sku, stock, listings }, 'Stock of a product recorded');
    }

    private async recordPrice(topic: string, value: Buffer | null): Promise<void> {
        if (!this._recordProductPricePort) {
            throw new UnprocessableMessageError('Price updates are not supported.');
        }
        const { productId, sku, price } = parseMessage(value, productPriceChangedSchema);
        const listings = await this._recordProductPricePort.recordPrice ? await this._recordProductPricePort.recordPrice({ sku, price }) : await (this._recordProductPricePort as any).record({ sku, price });

        this._logger.info({ topic, productId, sku, price, listings }, 'Price of a product recorded');
    }

}
