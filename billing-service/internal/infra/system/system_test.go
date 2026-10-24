package system_test

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/system"
)

func TestUUIDGeneratorCreatesDistinctValidUUIDs(t *testing.T) {
	generator := system.UUIDGenerator{}

	first, second := generator.NewID(), generator.NewID()

	if _, err := uuid.Parse(first); err != nil || first == second {
		t.Fatalf("NewID() = %q then %q, want two distinct valid UUIDs (parse error %v)", first, second, err)
	}
}

func TestClockTellsTheCurrentTimeInUTC(t *testing.T) {
	before := time.Now()

	got := system.Clock{}.Now()

	if got.Location() != time.UTC || got.Before(before.Add(-time.Second)) || got.After(time.Now().Add(time.Second)) {
		t.Fatalf("Now() = %v (%v), want the current time in UTC", got, got.Location())
	}
}
