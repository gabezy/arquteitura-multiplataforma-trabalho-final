import { Knex } from "knex";
import { Producer } from "kafkajs";

export class OutboxRelay {

    constructor(private readonly knex: Knex, private readonly producer: Producer, private readonly produtoCriadoTopic: string) {}

    async relay(): Promise<void> {
        await this.knex.transaction(async tx => {
            const rows = await tx('outbox')
                .whereNull('published_at')
                .orderBy('sequence')
                .limit(100)
                .forUpdate()
                .skipLocked();

            if (rows.length === 0) {
                return;
            }

            await this.producer.send({
                topic: this.produtoCriadoTopic,
                messages: rows.map(row => ({
                    key: row.aggregate_id,
                    value: JSON.stringify(row.payload),
                    headers: {
                        "event-type": row.event_type,
                        "ce_id": row.event_id,
                        "specversion": "1.0",
                        "ce_source": "/products",
                        "ce_type": "com.example.product.created",
                        "time": row.occurred_at.toISOString(),
                        "content-type": "application/json"
                    }
                }))
            })

            await tx("outbox").whereIn("sequence", rows.map(r => r.sequence)).update({ published_at: tx.fn.now() });
        })
    }

}