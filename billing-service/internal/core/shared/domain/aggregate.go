package domain

import "time"

// DomainEvent is a fact an aggregate records. The core never sees Kafka: the
// outbox maps each event to its public, versioned integration event.
type DomainEvent interface {
	EventName() string
	AggregateID() string
	OccurredAt() time.Time
}

// AggregateRoot collects the events an aggregate records until the repository
// pulls them to save them next to the aggregate.
type AggregateRoot struct {
	events []DomainEvent
}

// Record keeps an event until PullEvents.
func (a *AggregateRoot) Record(event DomainEvent) {
	a.events = append(a.events, event)
}

// PullEvents returns the recorded events in order and forgets them.
func (a *AggregateRoot) PullEvents() []DomainEvent {
	pulled := a.events
	a.events = nil
	return pulled
}
