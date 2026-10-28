package domain_test

import (
	"testing"
	"time"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/shared/domain"
)

type fakeEvent struct {
	name        string
	aggregateID string
	at          time.Time
}

func (e fakeEvent) EventName() string     { return e.name }
func (e fakeEvent) AggregateID() string   { return e.aggregateID }
func (e fakeEvent) OccurredAt() time.Time { return e.at }

type fakeAggregate struct{ domain.AggregateRoot }

func TestPullEventsReturnsRecordedEventsInOrderAndClearsThem(t *testing.T) {
	agg := &fakeAggregate{}
	first := fakeEvent{name: "first", aggregateID: "a-1"}
	second := fakeEvent{name: "second", aggregateID: "a-1"}

	agg.Record(first)
	agg.Record(second)

	pulled := agg.PullEvents()
	if len(pulled) != 2 || pulled[0].EventName() != "first" || pulled[1].EventName() != "second" {
		t.Fatalf("PullEvents() = %v, want [first second]", pulled)
	}
	if again := agg.PullEvents(); len(again) != 0 {
		t.Fatalf("a second PullEvents() = %v, want no events", again)
	}
}

func TestPullEventsOfAnAggregateWithoutEventsIsEmpty(t *testing.T) {
	if got := (&fakeAggregate{}).PullEvents(); len(got) != 0 {
		t.Fatalf("PullEvents() = %v, want no events", got)
	}
}
