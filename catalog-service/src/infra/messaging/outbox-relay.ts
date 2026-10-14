import { Knex } from "knex";
import { Message, Producer, TopicMessages } from "kafkajs";

const BATCH_SIZE = 100;
const SOURCE = "/catalog-service";

export type TopicsByAggregate = Record<string, string>;

export interface RelayLoopOptions {
    intervalMs: number;
    onError: (err: unknown) => void;
}

interface PendingRow {
    sequence: string;
    event_id: string;
    aggregate_type: string;
    aggregate_id: string;
    event_type: string;
    payload: unknown;
    occurred_at: Date;
}

export class OutboxRelay {

    private running = false;
    private loop?: Promise<void>;
    private wakeUp?: () => void;

    constructor(
        private readonly knex: Knex,
        private readonly producer: Producer,
        private readonly topics: TopicsByAggregate,
    ) {}

    // Each round starts only after the previous one ends, so rounds never overlap
    // and a slow broker cannot reorder events.
    start(options: RelayLoopOptions): void {
        if (this.running) {
            return;
        }
        this.running = true;
        this.loop = this.runLoop(options);
    }

    async stop(): Promise<void> {
        this.running = false;
        this.wakeUp?.();
        await this.loop;
    }

    private async runLoop({ intervalMs, onError }: RelayLoopOptions): Promise<void> {
        while (this.running) {
            await this.relay().catch(onError);
            await this.pause(intervalMs);
        }
    }

    private pause(ms: number): Promise<void> {
        if (!this.running) {
            return Promise.resolve();
        }
        return new Promise(resolve => {
            const timer = setTimeout(resolve, ms);
            this.wakeUp = () => {
                clearTimeout(timer);
                resolve();
            };
        });
    }

    async relay(): Promise<void> {
        await this.knex.transaction(async tx => {
            const rows: PendingRow[] = await tx('outbox')
                .whereNull('published_at')
                .orderBy('sequence')
                .limit(BATCH_SIZE)
                .forUpdate()
                .skipLocked();

            if (rows.length === 0) {
                return;
            }

            await this.producer.sendBatch({ topicMessages: this.groupByTopic(rows) });

            await tx("outbox").whereIn("sequence", rows.map(row => row.sequence)).update({ published_at: tx.fn.now() });
        });
    }

    private groupByTopic(rows: PendingRow[]): TopicMessages[] {
        const messagesByTopic = new Map<string, Message[]>();

        for (const row of rows) {
            const topic = this.topicOf(row.aggregate_type);
            messagesByTopic.set(topic, [...(messagesByTopic.get(topic) ?? []), this.toMessage(row)]);
        }

        return [...messagesByTopic].map(([topic, messages]) => ({ topic, messages }));
    }

    private topicOf(aggregateType: string): string {
        const topic = this.topics[aggregateType];
        if (!topic) {
            throw new Error(`No topic for aggregate ${aggregateType}.`);
        }
        return topic;
    }

    // CloudEvents binary mode: attributes go in ce_* headers, the value is the event data.
    private toMessage(row: PendingRow): Message {
        return {
            key: row.aggregate_id,
            value: JSON.stringify(row.payload),
            headers: {
                ce_specversion: "1.0",
                ce_id: row.event_id,
                ce_source: SOURCE,
                ce_type: row.event_type,
                ce_subject: row.aggregate_id,
                ce_time: row.occurred_at.toISOString(),
                "content-type": "application/json",
            },
        };
    }

}
