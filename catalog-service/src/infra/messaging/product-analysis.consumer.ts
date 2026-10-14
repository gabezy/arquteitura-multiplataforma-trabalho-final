import { Consumer, EachMessagePayload, KafkaMessage, Producer } from "kafkajs";
import { Logger } from "pino";
import { z } from "zod";
import { CompleteProductAnalysisPort, CompleteProductAnalysisPortInput } from "../../core/product/port/in/complete-product-analysis.port";
import { DomainError } from "../../core/shared/domain/domain.error";

// Contract published by the compliance-service. Translating it here keeps that
// service's vocabulary out of the core (anticorruption layer).
const analysisResultSchema = z.object({
    sku: z.string(),
    status: z.enum(['APPROVED', 'REJECTED']),
});

export interface ProductAnalysisTopics {
    topic: string;
    deadLetterTopic: string;
}

class UnprocessableMessageError extends Error {}

export class ProductAnalysisConsumer {

    constructor(
        private readonly completeProductAnalysisPort: CompleteProductAnalysisPort,
        private readonly consumer: Consumer,
        private readonly producer: Producer,
        private readonly topics: ProductAnalysisTopics,
        private readonly logger: Logger
    ) {}

    public async start(): Promise<void> {
        await this.consumer.connect();
        await this.consumer.subscribe({ topics: [this.topics.topic], fromBeginning: true });
        await this.consumer.run({ eachMessage: this.handle });
    }

    // Retrying a message that can never succeed would block its partition, so such
    // messages go to the dead letter topic. Anything else is rethrown and redelivered.
    private handle = async ({ topic, partition, message }: EachMessagePayload): Promise<void> => {
        const position = { topic, partition, offset: message.offset };
        this.logger.info(position, 'Product analysis received');

        try {
            await this.completeProductAnalysisPort.completeAnalysis(this.toInput(message.value));
        } catch (err) {
            if (!(err instanceof UnprocessableMessageError || err instanceof DomainError)) {
                throw err;
            }
            this.logger.warn({ ...position, err }, 'Product analysis sent to the dead letter topic');
            await this.sendToDeadLetter(topic, partition, message, err.message);
        }
    };

    private toInput(value: Buffer | null): CompleteProductAnalysisPortInput {
        if (!value) {
            throw new UnprocessableMessageError('Message has no value.');
        }

        let json: unknown;
        try {
            json = JSON.parse(value.toString());
        } catch {
            throw new UnprocessableMessageError('Message is not valid JSON.');
        }

        const result = analysisResultSchema.safeParse(json);
        if (!result.success) {
            throw new UnprocessableMessageError(z.prettifyError(result.error));
        }

        return { sku: result.data.sku, status: result.data.status };
    }

    private async sendToDeadLetter(topic: string, partition: number, message: KafkaMessage, reason: string): Promise<void> {
        await this.producer.send({
            topic: this.topics.deadLetterTopic,
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

}
