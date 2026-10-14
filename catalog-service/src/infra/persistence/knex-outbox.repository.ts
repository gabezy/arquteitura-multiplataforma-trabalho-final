import { Knex } from "knex";
import { DomainEvent } from "../../core/shared/domain/domain.event";
import { IntegrationEventMapper } from "../messaging/integration-event";

export interface OutboxRow {
    event_id: string;
    aggregate_type: string;
    aggregate_id: string;
    event_type: string;
    headers?: string;
    payload: string;
    occurred_at: Date;
}

// Rows hold the public integration event, not the domain event, so the relay
// (or a CDC connector) can publish them as they are.
export class KnexOutboxRepository {

    constructor(private readonly toIntegrationEvent: IntegrationEventMapper) {}

    async append(tx: Knex.Transaction, aggregateType: string, events: DomainEvent[]): Promise<void> {
        if (events.length === 0) {
            return;
        }

        await tx("outbox").insert(events.map(event => this.toRow(aggregateType, event)));
    }

    private toRow(aggregateType: string, event: DomainEvent): OutboxRow {
        const { type, data } = this.toIntegrationEvent(event);
        return {
            event_id: event.eventId,
            aggregate_type: aggregateType,
            aggregate_id: event.aggregateId,
            event_type: type,
            payload: JSON.stringify(data),
            // headers: JSON.stringify(currentTraceHeaders()),
            occurred_at: event.occurredOn,
        };
    }

}