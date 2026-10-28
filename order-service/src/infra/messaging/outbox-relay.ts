import { Knex } from "knex";
import { Message, Producer, TopicMessages } from "kafkajs";
import { TraceHeaders, withTraceHeaders } from "../observability/trace-context";

const BATCH_SIZE = 100;
const SOURCE = "/order-service";

export interface RelayLoopOptions {
    intervalMs: number;
    onError: (err: unknown) => void;
}

interface PendingRow {
    sequence: string;
    event_id: string;
    aggregate_id: string;
    event_type: string;
    payload: unknown;
    headers: TraceHeaders | null;
    occurred_at: Date;
}

export class OutboxRelay {

    private running = false;
    private loop?: Promise<void>;
    private wakeUp?: () => void;

    constructor(private readonly knex: Knex, private readonly producer: Producer) {}

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

            for (const group of this.splitByTraceContext(rows)) {
                await withTraceHeaders(group[0].headers, () =>
                    this.producer.sendBatch({ topicMessages: this.groupByTopic(group) }));
            }

            await tx("outbox").whereIn("sequence", rows.map(row => row.sequence)).update({ published_at: tx.fn.now() });
        });
    }

    // The Kafka instrumentation parents every message of a sendBatch on the active context,
    // so events recorded by different requests go in separate batches, each sent inside the
    // trace that recorded them. Groups are consecutive and sent in turn, keeping the outbox order.
    private splitByTraceContext(rows: PendingRow[]): PendingRow[][] {
        const groups: PendingRow[][] = [];

        for (const row of rows) {
            const last = groups.at(-1);
            if (last && last[0].headers?.traceparent === row.headers?.traceparent) {
                last.push(row);
            } else {
                groups.push([row]);
            }
        }

        return groups;
    }

    // Each event type has its own topic, named after its public type (catalog.product.created.v1).
    private groupByTopic(rows: PendingRow[]): TopicMessages[] {
        const messagesByTopic = new Map<string, Message[]>();

        for (const row of rows) {
            const topic = row.event_type;
            messagesByTopic.set(topic, [...(messagesByTopic.get(topic) ?? []), this.toMessage(row)]);
        }

        return [...messagesByTopic].map(([topic, messages]) => ({ topic, messages }));
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
