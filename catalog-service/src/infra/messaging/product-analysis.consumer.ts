import { Consumer, EachMessagePayload, Producer } from "kafkajs";
import { Logger } from "pino";
import { z } from "zod";
import { CompleteProductAnalysisPort } from "../../core/product/port/in/complete-product-analysis.port";
import { DomainError } from "../../core/shared/domain/domain.error";
import { parseMessage, sendToDeadLetter, UnprocessableMessageError } from "./dead-letter";

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
    private handle = async (payload: EachMessagePayload): Promise<void> => {
        const { topic, partition, message } = payload;
        const position = { topic, partition, offset: message.offset };
        this.logger.info(position, 'Product analysis received');

        try {
            const { sku, status } = parseMessage(message.value, analysisResultSchema);
            await this.completeProductAnalysisPort.completeAnalysis({ sku, status });
        } catch (err) {
            if (!(err instanceof UnprocessableMessageError || err instanceof DomainError)) {
                throw err;
            }
            this.logger.warn({ ...position, err }, 'Product analysis sent to the dead letter topic');
            await sendToDeadLetter(this.producer, this.topics.deadLetterTopic, payload, err.message);
        }
    };

}
