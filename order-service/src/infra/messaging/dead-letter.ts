import { EachMessagePayload, IHeaders, Producer } from 'kafkajs';
import { z } from 'zod';

export class UnprocessableMessageError extends Error {}

export function parseMessage<T extends z.ZodType>(value: Buffer | null, schema: T): z.infer<T> {
    if (!value) {
        throw new UnprocessableMessageError('Message has no value.');
    }

    let json: unknown;
    try {
        json = JSON.parse(value.toString());
    } catch {
        throw new UnprocessableMessageError('Message is not valid JSON.');
    }

    const result = schema.safeParse(json);
    if (!result.success) {
        throw new UnprocessableMessageError(z.prettifyError(result.error));
    }

    return result.data;
}

export function headerValue(headers: IHeaders | undefined, name: string): string | undefined {
    const value = headers?.[name];
    const first = Array.isArray(value) ? value[0] : value;
    return first === undefined ? undefined : first.toString();
}

export async function sendToDeadLetter(
    producer: Producer,
    deadLetterTopic: string,
    { topic, partition, message }: Pick<EachMessagePayload, 'topic' | 'partition' | 'message'>,
    reason: string,
): Promise<void> {
    await producer.send({
        topic: deadLetterTopic,
        messages: [{
            key: message.key,
            value: message.value,
            headers: {
                ...message.headers,
                'dlq-original-topic': topic,
                'dlq-original-partition': String(partition),
                'dlq-original-offset': message.offset,
                'dlq-reason': reason,
            },
        }],
    });
}
