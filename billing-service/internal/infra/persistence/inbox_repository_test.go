package persistence_test

import (
	"context"
	"errors"
	"testing"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/persistence"
)

// INV-04: the second time an event id arrives it is not new.
func TestInboxMarkProcessedReportsOnlyTheFirstTime(t *testing.T) {
	db := openMigrated(t)
	inbox := persistence.NewInboxRepository(db)
	ctx := context.Background()

	for attempt, want := range []bool{true, false, false} {
		got, err := inbox.MarkProcessed(ctx, "evt-1", "order.order.confirmed.v1")
		if err != nil || got != want {
			t.Fatalf("attempt %d: MarkProcessed() = (%v, %v), want (%v, nil)", attempt+1, got, err, want)
		}
	}
	if got, err := inbox.MarkProcessed(ctx, "evt-2", "order.order.confirmed.v1"); err != nil || !got {
		t.Fatalf("a different event id: MarkProcessed() = (%v, %v), want (true, nil)", got, err)
	}
}

// INV-07: when the use case fails, the mark rolls back with it so that the redelivery is processed.
func TestInboxMarkRollsBackWithTheTransaction(t *testing.T) {
	db := openMigrated(t)
	inbox := persistence.NewInboxRepository(db)
	ctx := context.Background()
	boom := errors.New("use case failed")

	err := db.WithinTransaction(ctx, func(ctx context.Context) error {
		if first, err := inbox.MarkProcessed(ctx, "evt-1", "order.order.confirmed.v1"); err != nil || !first {
			t.Fatalf("MarkProcessed() = (%v, %v), want (true, nil)", first, err)
		}
		return boom
	})
	if !errors.Is(err, boom) {
		t.Fatalf("error = %v, want %v", err, boom)
	}

	if first, err := inbox.MarkProcessed(ctx, "evt-1", "order.order.confirmed.v1"); err != nil || !first {
		t.Fatalf("MarkProcessed() after the rollback = (%v, %v), want (true, nil): the event was never processed", first, err)
	}
}
