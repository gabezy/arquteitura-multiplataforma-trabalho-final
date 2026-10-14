import { Consumer, ConsumerSubscribeTopics, EachMessagePayload } from "kafkajs";
import { CompleteProductAnalysisPort, CompleteProductAnalysisPortInput } from "../../core/product/port/in/complete-product-analysis.port";
import { Logger } from "pino";

export class ProductAnalysisConsumer {

    constructor(
        private readonly completeProductAnalysisPort: CompleteProductAnalysisPort,
        private readonly consumer: Consumer,
        private readonly produtoAnaliseCompletaTopic: string,
        private readonly logger: Logger
    ) {}


    public async start(): Promise<void> {
        const topic: ConsumerSubscribeTopics = {
            topics: [this.produtoAnaliseCompletaTopic],
            fromBeginning: false
        };

        await this.consumer.connect()
        await this.consumer.subscribe(topic);

        await this.consumer.run({
            eachMessage: async ({ topic, partition, message }) => {
                this.logger.info(`Received message from topic ${topic}, partition ${partition}, offset ${message.offset}`);

                // validate if event has already been processed (idempotency check) 
                const data = JSON.parse(message.value?.toString() as string) as CompleteProductAnalysisPortInput;
                await this.completeProductAnalysisPort.completeAnalysis(data);
            }
        })

    }


}