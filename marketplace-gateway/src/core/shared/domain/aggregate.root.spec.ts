import { AggregateRoot } from './aggregate.root';
import { DomainEvent } from './domain.event';
import { Id } from './id';

class SomethingHappened extends DomainEvent {
  readonly eventName = 'SomethingHappened';

  constructor(aggregateId: string) {
    super(aggregateId);
  }
}

class Thing extends AggregateRoot<Id> {
  constructor() {
    super(new Id());
  }

  happen(): void {
    this.record(new SomethingHappened(this.id.value));
  }

  protected validate(): void {}
}

describe('AggregateRoot', () => {
  it('returns the recorded events in order and then forgets them', () => {
    const thing = new Thing();
    thing.happen();
    thing.happen();

    const events = thing.pullDomainEvents();

    expect(events).toHaveLength(2);
    expect(events.every(event => event instanceof SomethingHappened)).toBe(true);
    expect(events.map(event => event.aggregateId)).toEqual([thing.id.value, thing.id.value]);
    expect(events[0].eventId).not.toBe(events[1].eventId);
    expect(thing.pullDomainEvents()).toEqual([]);
  });
});
