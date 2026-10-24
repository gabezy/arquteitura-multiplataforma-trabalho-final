import { DomainEvent } from "../../core/shared/domain/domain.event";

// The public, versioned contract other services consume. Domain events stay internal
// and may change freely; only this shape is published.
export interface IntegrationEvent {
    type: string;
    data: Record<string, unknown>;
}

export type IntegrationEventMapper = (event: DomainEvent) => IntegrationEvent;
