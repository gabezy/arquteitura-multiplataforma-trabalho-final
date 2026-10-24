import { Consumer, EachMessagePayload, IHeaders, Producer } from 'kafkajs';
import { Logger } from 'pino';
import { z } from 'zod';
import { Money } from '../../core/order/model/money.vo';
import { ReceiveOrderPort } from '../../core/order/port/in/receive-order.port';
import { DomainError } from '../../core/shared/domain/domain.error';
import { withTraceHeaders } from '../observability/trace-context';
import { cloudEventHeaderError, EVENT_ID, isDataException, traceHeadersOf } from './cloud-event';
import { headerValue, parseMessage, sendToDeadLetter, UnprocessableMessageError } from './dead-letter';
import { Inbox } from './inbox';

const TOPIC = 'marketplace.order.received.v1';
const EVENT_SOURCE = '/marketplace-gateway';
const DEAD_LETTER_TOPIC = 'order.marketplace-order.dlq';
const NO_NUL = (value: string): boolean => !value.includes('\u0000');

const text = (max: number) => z.string().trim().min(1).max(max).refine(NO_NUL, 'must not contain NUL');

const orderReceivedSchema = z.object({
    marketplace: z.enum(['AMAZON', 'MERCADO_LIVRE', 'SHOPEE']),
    externalOrderId: text(100),
    items: z.array(z.object({
        sku: text(64),
        quantity: z.number().int().min(1).max(10_000),
        unitPrice: z.number().min(0.01).max(1_000_000),
    })).min(1).max(100),
    total: z.number().finite().nonnegative(),
    orderedAt: z.iso.datetime({ offset: true }),
});

export interface MarketplaceOrderConsumerProps {
    consumer: Consumer;
    producer: Producer;
    inbox: Inbox;
    receiveOrder: ReceiveOrderPort;
    logger: Logger;
}

export class MarketplaceOrderConsumer {

    constructor(private readonly props: MarketplaceOrderConsumerProps) {}

    async start(): Promise<void> {
        await this.props.consumer.connect();
        await this.props.consumer.subscribe({ topics: [TOPIC], fromBeginning: true });
        await this.props.consumer.run({ eachMessage: this.handle });
    }

    async disconnect(): Promise<void> {
        await this.props.consumer.disconnect();
    }

    private handle = (payload: EachMessagePayload): Promise<void> =>
        withTraceHeaders(traceHeadersOf(payload.message.headers), () => this.process(payload));

    private async process(payload: EachMessagePayload): Promise<void> {
        const { topic, partition, message } = payload;
        const position = { topic, partition, offset: message.offset };
        const eventId = headerValue(message.headers, 'ce_id');
        const headerError = cloudEventHeaderError(message.headers, eventId, { source: EVENT_SOURCE, type: TOPIC });

        if (headerError) {
            this.props.logger.warn({ ...position, reason: headerError }, 'Marketplace order sent to the dead letter topic');
            await sendToDeadLetter(this.props.producer, DEAD_LETTER_TOPIC, payload, headerError);
            if (eventId && EVENT_ID.test(eventId)) {
                await this.props.inbox.markProcessed(eventId, topic);
            }
            return;
        }

        if (eventId && await this.props.inbox.hasProcessed(eventId)) {
            this.props.logger.info({ ...position, eventId }, 'Marketplace order already handled');
            return;
        }

        try {
            const { total: declaredTotal, orderedAt, ...order } = parseMessage(message.value, orderReceivedSchema);
            if (headerValue(message.headers, 'ce_subject') !== `${order.marketplace}:${order.externalOrderId}`) {
                throw new UnprocessableMessageError('ce_subject must identify the marketplace order.');
            }
            const total = order.items.reduce(
                (sum, item) => sum.plus(Money.ofAmount(item.unitPrice).times(item.quantity)),
                Money.ofCents(0),
            );
            const result = await this.props.receiveOrder.receive({
                eventId,
                ...order,
                total: total.amount,
                orderedAt: new Date(orderedAt),
            });

            if (totalDiffers(declaredTotal, total.value)) {
                this.props.logger.warn(
                    { marketplace: order.marketplace, externalOrderId: order.externalOrderId, declaredTotal, total: total.amount },
                    'Declared total differs from the items; using the items',
                );
            }

            if (result.created) {
                this.props.logger.info({ ...position, orderId: result.orderId, ...order }, 'Marketplace order received');
            } else {
                this.props.logger.info({ ...position, ...order }, 'Marketplace order already exists');
            }
        } catch (err) {
            if (!(err instanceof UnprocessableMessageError || err instanceof DomainError || isDataException(err))) {
                throw err;
            }
            this.props.logger.warn({ ...position, reason: err.message }, 'Marketplace order sent to the dead letter topic');
            await sendToDeadLetter(this.props.producer, DEAD_LETTER_TOPIC, payload, err.message);
            if (eventId) {
                await this.props.inbox.markProcessed(eventId, topic);
            }
        }
    }

}

function totalDiffers(declaredTotal: number, totalCents: number): boolean {
    const declaredCents = declaredTotal * 100;
    const roundedCents = Math.round(declaredCents);
    return !Number.isSafeInteger(roundedCents)
        || Math.abs(declaredCents - roundedCents) > 1e-5
        || roundedCents !== totalCents;
}
