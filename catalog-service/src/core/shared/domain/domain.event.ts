export abstract class DomainEvent {
    readonly eventId = crypto.randomUUID();
    readonly occurredOn = new Date();

    protected constructor(readonly aggregateId: string) {}

    abstract get eventName(): string;

}