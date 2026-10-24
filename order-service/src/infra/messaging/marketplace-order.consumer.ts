import { Consumer, EachMessagePayload, IHeaders, Producer } from 'kafkajs';
import { Logger } from 'pino';
import { z } from 'zod';
import { MARKETPLACES } from '../../core/order/model/marketplace';
import { ReceiveOrderPort } from '../../core/order/port/in/receive-order.port';
import { DomainError } from '../../core/shared/domain/domain.error';
import { TraceHeaders, withTraceHeaders } from '../observability/trace-context';
import { headerValue, parseMessage, sendToDeadLetter, UnprocessableMessageError } from './dead-letter';
import { Inbox } from './inbox';

// marketplace.order.received.v1, published by the marketplace-gateway (docs/eventos.md).
// The declared total is only compared: the order total always comes from its items.
const orderReceivedSchema = z.object({
    marketplace: z.enum(MARKETPLACES),
    externalOrderId: z.string().trim().min(1),
    items: z.array(z.object({
        sku: z.string().trim().min(1),
        quantity: z.number().int().positive(),
        unitPrice: z.number().nonnegative(),
    })).min(1),
    total: z.number(),
    orderedAt: z.iso.datetime({ offset: true }),
});

const TRACE_HEADERS = ['traceparent', 'tracestate', 'baggage'];

export interface MarketplaceOrderTopics {
    topic: string;
    deadLetterTopic: string;
}

export class MarketplaceOrderConsumer {

    constructor(
        private readonly receiveOrderPort: ReceiveOrderPort,
        private readonly consumer: Consumer,
        private readonly producer: Producer,
        private readonly inbox: Inbox,
        private readonly topics: MarketplaceOrderTopics,
        private readonly logger: Logger,
    ) {}

    public async start(): Promise<void> {
        await this.consumer.connect();
        await this.consumer.subscribe({ topics: [this.topics.topic], fromBeginning: true });
        await this.consumer.run({ eachMessage: this.handle });
    }

    // Runs in the trace of the message, so the placed event the outbox keeps joins the same trace.
    private handle = (payload: EachMessagePayload): Promise<void> =>
        withTraceHeaders(traceHeadersOf(payload.message.headers), () => this.process(payload));

    // A message that can never succeed (outside the contract, or refused by the domain) goes to the dead
    // letter topic. Anything else, such as a database that is down, is rethrown and redelivered.
    private async process(payload: EachMessagePayload): Promise<void> {
        const { topic, partition, message } = payload;
        const position = { topic, partition, offset: message.offset };
        const eventId = headerValue(message.headers, 'ce_id');

        if (eventId && await this.inbox.hasProcessed(eventId)) {
            this.logger.info({ ...position, eventId }, 'Marketplace order already handled');
            return;
        }

        try {
            const { total: declaredTotal, orderedAt, ...order } = parseMessage(message.value, orderReceivedSchema);
            const { outcome, order: received } = await this.receiveOrderPort.receive({ eventId, ...order, orderedAt: new Date(orderedAt) });
            const { marketplace, externalOrderId } = received;

            if (received.total !== declaredTotal) {
                this.logger.warn({ marketplace, externalOrderId, declaredTotal, total: received.total }, 'Declared total differs from the items; using the items');
            }

            if (outcome === 'created') {
                this.logger.info({ ...position, orderId: received.id, marketplace, externalOrderId }, 'Marketplace order received');
            } else {
                this.logger.info({ ...position, marketplace, externalOrderId }, 'Marketplace order already exists');
            }
        } catch (err) {
            if (!(err instanceof UnprocessableMessageError || err instanceof DomainError)) {
                throw err;
            }
            this.logger.warn({ ...position, reason: err.message }, 'Marketplace order sent to the dead letter topic');
            await sendToDeadLetter(this.producer, this.topics.deadLetterTopic, payload, err.message);
            if (eventId) {
                await this.inbox.markProcessed(eventId, topic);
            }
        }
    }

}

function traceHeadersOf(headers: IHeaders | undefined): TraceHeaders {
    const traceHeaders: TraceHeaders = {};
    for (const name of TRACE_HEADERS) {
        const value = headerValue(headers, name);
        if (value !== undefined) {
            traceHeaders[name] = value;
        }
    }
    return traceHeaders;
}
