import { DomainEvent } from "./domain.event";
import { Entity } from "./entity";

export abstract class AggregateRoot<TId extends { equals(other: TId): boolean }> extends Entity<TId> {
    private _domainEvents: DomainEvent[] = [];

    protected record(event: DomainEvent): void {
        this._domainEvents.push(event);
    }

    pullDomainEvents(): DomainEvent[] {
        const events = this._domainEvents;
        this._domainEvents = [];
        return events;
    }

}