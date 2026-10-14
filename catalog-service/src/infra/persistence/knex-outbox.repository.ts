import { Knex } from "knex";
import { DomainEvent } from "../../core/shared/domain/domain.event";

export interface OutboxRow {
    event_id: string;
    aggregate_type: string;
    aggregate_id: string;
    event_type: string;
    headers?: string;
    payload: string;
    occurred_at: Date;
}

export class KnexOutboxRepository {

    async append(tx: Knex.Transaction, aggregateType: string, events: DomainEvent[]): Promise<void> {
        if (events.length === 0) {
            return;
        }

        await tx("outbox").insert(events.map(event => this.toRow(aggregateType, event)));
    }

    private toRow(aggregateType: string, event: DomainEvent): OutboxRow {
        const { eventId, occurredOn, aggregateId, eventName, ...payload } = event;
        return {
            event_id: eventId,
            aggregate_type: aggregateType,
            aggregate_id: aggregateId,
            event_type: eventName,
            payload: JSON.stringify(payload),
            // headers: JSON.stringify(currentTraceHeaders()),
            occurred_at: occurredOn,
        };
    }

}