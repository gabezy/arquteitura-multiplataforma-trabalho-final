import { Consumer, EachMessagePayload, IHeaders, Producer } from 'kafkajs';
import { Logger } from 'pino';
import { z } from 'zod';
import { MARKETPLACES } from '../../core/order/model/marketplace';
import { ReceiveOrderPort } from '../../core/order/port/in/receive-order.port';
import { DomainError } from '../../core/shared/domain/domain.error';
import { TraceHeaders, withTraceHeaders } from '../observability/trace-context';
import { headerValue, parseMessage, sendToDeadLetter, UnprocessableMessageError } from './dead-letter';
import { Inbox } from './inbox';

// Storage limits of orders and order_items: a value past them can never be saved, so the message
// goes to the dead letter topic instead of failing in the database on every redelivery.
const MAX_INT4 = 2_147_483_647;
const MAX_DECIMAL_14_2 = 999_999_999_999.99;
const MAX_TEXT = 200;
const MAX_ITEMS = 1000;

const text = z.string().trim().min(1).max(MAX_TEXT).refine(value => !value.includes('\u0000'), 'must not contain NUL');

// marketplace.order.received.v1, published by the marketplace-gateway (docs/eventos.md).
// The declared total is only compared: the order total always comes from its items.
const orderReceivedSchema = z.object({
    marketplace: z.enum(MARKETPLACES),
    externalOrderId: text,
    items: z.array(z.object({
        sku: text,
        quantity: z.number().int().positive().max(MAX_INT4),
        unitPrice: z.number().nonnegative().max(MAX_DECIMAL_14_2),
    })).min(1).max(MAX_ITEMS),
    total: z.number(),
    orderedAt: z.iso.datetime({ offset: true }),
});

// processed_events.event_id is text: printable ASCII keeps a NUL or a huge header out of the query.
const CE_ID = /^[\x20-\x7E]{1,200}$/;

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

        if (eventId !== undefined && !CE_ID.test(eventId)) {
            this.logger.warn({ ...position, reason: 'invalid ce_id' }, 'Marketplace order sent to the dead letter topic');
            await sendToDeadLetter(this.producer, this.topics.deadLetterTopic, payload, 'ce_id must be 1 to 200 printable ASCII characters.');
            return;
        }

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
            if (!(err instanceof UnprocessableMessageError || err instanceof DomainError || isDataException(err))) {
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

// SQLSTATE class 22 (data exception, e.g. 22003 numeric overflow): the database refuses the values
// themselves, so a redelivery fails the same way. Connection and lock errors keep being retried.
function isDataException(err: unknown): err is Error {
    const code = err instanceof Error ? (err as Error & { code?: unknown }).code : undefined;
    return typeof code === 'string' && code.startsWith('22');
}
