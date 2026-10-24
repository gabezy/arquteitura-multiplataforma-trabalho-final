package messaging_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/twmb/franz-go/pkg/kfake"
	"github.com/twmb/franz-go/pkg/kgo"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/messaging"
)

// offsetHandler answers by the offset of the message: 0 is processed, 1 breaks the contract, and from
// failFrom on every message fails with a transient error, forever. A negative failFrom never fails.
type offsetHandler struct {
	mu       sync.Mutex
	failFrom int64
	calls    map[int64]int
	order    []int64
}

func newOffsetHandler(failFrom int64) *offsetHandler {
	return &offsetHandler{failFrom: failFrom, calls: map[int64]int{}}
}

func (h *offsetHandler) Handle(_ context.Context, message messaging.Message) error {
	h.mu.Lock()
	h.calls[message.Offset]++
	h.order = append(h.order, message.Offset)
	h.mu.Unlock()

	switch {
	case message.Offset == 1:
		return &messaging.UnprocessableError{Reason: "the message breaks the contract"}
	case h.failFrom >= 0 && message.Offset >= h.failFrom:
		return errors.New("database is down")
	}
	return nil
}

func (h *offsetHandler) tries(offset int64) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.calls[offset]
}

func (h *offsetHandler) firstOffset() int64 {
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.order) == 0 {
		return -1
	}
	return h.order[0]
}

type offsetDeadLetter struct {
	mu      sync.Mutex
	offsets []int64
}

func (d *offsetDeadLetter) Publish(_ context.Context, message messaging.Message, _ string) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.offsets = append(d.offsets, message.Offset)
	return nil
}

func (d *offsetDeadLetter) published() []int64 {
	d.mu.Lock()
	defer d.mu.Unlock()
	return append([]int64(nil), d.offsets...)
}

func waitUntil(t *testing.T, what string, timeout time.Duration, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for !condition() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// runConsumer starts a consumer of the group and returns what it takes to stop it and to read its offsets.
func runConsumer(t *testing.T, brokers []string, group string, handler messaging.MessageHandler, dead messaging.DeadLetter) (stop func(), client *kgo.Client) {
	t.Helper()
	client, tracer, err := messaging.NewConsumerClient(brokers, group, confirmedTopic, cancelledTopic)
	if err != nil {
		t.Fatal(err)
	}
	consumer := messaging.NewOrderEventsConsumer(client, tracer, handler, dead, slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- consumer.Run(ctx) }()
	return func() {
		cancel()
		select {
		case <-done:
		case <-time.After(10 * time.Second):
			t.Error("the consumer did not stop after its context ended")
		}
	}, client
}

// INV-06 and INV-07: the offset moves past a message that was processed or dead-lettered, and stays on
// one that keeps failing, so the next instance of the group takes it again.
func TestOffsetsAreCommittedOnlyAfterTheMessageWasProcessedOrDeadLettered(t *testing.T) {
	ctx := context.Background()
	cluster, err := kfake.NewCluster(kfake.NumBrokers(1), kfake.SeedTopics(1, confirmedTopic, cancelledTopic))
	if err != nil {
		t.Fatal(err)
	}
	defer cluster.Close()
	brokers := cluster.ListenAddrs()

	producer, err := kgo.NewClient(kgo.SeedBrokers(brokers...))
	if err != nil {
		t.Fatal(err)
	}
	defer producer.Close()
	record := func(n string) *kgo.Record {
		return &kgo.Record{Topic: confirmedTopic, Key: []byte(orderID), Value: []byte(`{"n":"` + n + `"}`)}
	}
	if err := producer.ProduceSync(ctx, record("0"), record("1"), record("2")).FirstErr(); err != nil {
		t.Fatal(err)
	}

	// The first instance processes offset 0, dead-letters offset 1, and keeps failing on offset 2.
	handler := newOffsetHandler(2)
	dead := &offsetDeadLetter{}
	stop, client := runConsumer(t, brokers, "commit-group", handler, dead)
	waitUntil(t, "offset 2 to be tried again in place", 40*time.Second, func() bool { return handler.tries(2) >= 2 })
	stop()

	committed, ok := client.CommittedOffsets()[confirmedTopic][0]
	if !ok || committed.Offset != 2 {
		t.Fatalf("committed offset = %d (found %v), want 2: past the processed and the dead-lettered messages, and not past the one still failing", committed.Offset, ok)
	}
	if got := dead.published(); len(got) != 1 || got[0] != 1 {
		t.Fatalf("dead letters at offsets %v, want only offset 1", got)
	}
	leave, cancelLeave := context.WithTimeout(ctx, 5*time.Second)
	_ = client.LeaveGroupContext(leave)
	cancelLeave()
	client.Close()

	// The next instance of the group resumes at the message that failed.
	next := newOffsetHandler(-1)
	stopNext, nextClient := runConsumer(t, brokers, "commit-group", next, &offsetDeadLetter{})
	defer nextClient.Close()
	waitUntil(t, "the next instance to receive the message that failed", 60*time.Second, func() bool { return next.tries(2) >= 1 })
	stopNext()

	if next.firstOffset() != 2 || next.tries(0) != 0 || next.tries(1) != 0 {
		t.Fatalf("the next instance started at offset %d (tries of 0 and 1: %d and %d), want it to resume at offset 2", next.firstOffset(), next.tries(0), next.tries(1))
	}
}
