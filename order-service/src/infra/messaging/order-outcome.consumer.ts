import { Consumer, EachMessagePayload, Producer } from 'kafkajs';
import { Logger } from 'pino';
import { z } from 'zod';
import { OrderNotFoundError, OrderStateConflictError } from '../../core/order/model/order.errors';
import { DomainError } from '../../core/shared/domain/domain.error';
import { withTraceHeaders } from '../observability/trace-context';
import { cloudEventHeaderError, EVENT_ID, isDataException, traceHeadersOf } from './cloud-event';
import { headerValue, parseMessage, sendToDeadLetter, UnprocessableMessageError } from './dead-letter';
import { Inbox } from './inbox';

// One consumed topic: the shape of its payload, the aggregate its ce_subject must name, and what it does to the order.
export interface OutcomeTopic<T> {
    schema: z.ZodType<T>;
    subject(data: T): string;
    apply(data: T): Promise<void>;
}

// Keeps the type of the payload between the schema and the callbacks of one topic.
export const outcomeTopic = <T>(topic: OutcomeTopic<T>): OutcomeTopic<unknown> => topic as OutcomeTopic<unknown>;

export interface OrderOutcomeConsumerProps {
    consumer: Consumer;
    producer: Producer;
    inbox: Inbox;
    logger: Logger;
    // The ce_source of the producing service.
    source: string;
    deadLetterTopic: string;
    topics: Record<string, OutcomeTopic<unknown>>;
}

// Applies the answers of another service (the stock of the catalog, the payment of the billing) to the orders.
// An answer that contradicts the order or names no order is valid but late or stale: it is logged and skipped,
// never parked. Only a message out of contract goes to the dead letter topic; anything else is redelivered.
export class OrderOutcomeConsumer {

    constructor(private readonly props: OrderOutcomeConsumerProps) {}

    async start(): Promise<void> {
        await this.props.consumer.connect();
        await this.props.consumer.subscribe({ topics: Object.keys(this.props.topics), fromBeginning: true });
        await this.props.consumer.run({ eachMessage: this.handle });
    }

    async disconnect(): Promise<void> {
        await this.props.consumer.disconnect();
    }

    // Runs in the trace of the message, so the events the outbox keeps join the same trace.
    private handle = (payload: EachMessagePayload): Promise<void> =>
        withTraceHeaders(traceHeadersOf(payload.message.headers), () => this.process(payload));

    private async process(payload: EachMessagePayload): Promise<void> {
        const { topic, partition, message } = payload;
        const position = { topic, partition, offset: message.offset };
        const eventId = headerValue(message.headers, 'ce_id');
        const headerError = cloudEventHeaderError(message.headers, eventId, { source: this.props.source, type: topic });

        if (headerError) {
            await this.deadLetter(payload, headerError, eventId !== undefined && EVENT_ID.test(eventId) ? eventId : undefined);
            return;
        }

        if (await this.props.inbox.hasProcessed(eventId!)) {
            this.props.logger.info({ ...position, eventId }, 'Order outcome already handled');
            return;
        }

        try {
            const outcome = this.props.topics[topic];
            const data = parseMessage(message.value, outcome.schema);
            if (headerValue(message.headers, 'ce_subject') !== outcome.subject(data)) {
                throw new UnprocessableMessageError('ce_subject must identify the aggregate of the payload.');
            }

            await outcome.apply(data);
            this.props.logger.info({ ...position, eventId }, 'Order outcome applied');
        } catch (err) {
            if (err instanceof OrderStateConflictError || err instanceof OrderNotFoundError) {
                this.props.logger.warn({ ...position, eventId, orderId: err.orderId, reason: err.message }, 'Order outcome skipped');
            } else if (err instanceof UnprocessableMessageError || err instanceof DomainError || isDataException(err)) {
                await this.deadLetter(payload, err.message, eventId);
                return;
            } else {
                throw err;
            }
        }

        await this.props.inbox.markProcessed(eventId!, topic);
    }

    private async deadLetter(payload: EachMessagePayload, reason: string, eventId: string | undefined): Promise<void> {
        const { topic, partition, message } = payload;
        this.props.logger.warn({ topic, partition, offset: message.offset, reason }, 'Order outcome sent to the dead letter topic');
        await sendToDeadLetter(this.props.producer, this.props.deadLetterTopic, payload, reason);
        if (eventId) {
            await this.props.inbox.markProcessed(eventId, topic);
        }
    }

}
