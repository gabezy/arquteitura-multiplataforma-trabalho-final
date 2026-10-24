package outbox_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/shared/domain"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/outbox"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/persistence"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/testsupport"
)

func TestMain(m *testing.M) {
	otel.SetTextMapPropagator(propagation.TraceContext{})
	code := m.Run()
	testsupport.Terminate()
	os.Exit(code)
}

type testEvent struct {
	name        string
	aggregateID string
	at          time.Time
}

func (e testEvent) EventName() string     { return e.name }
func (e testEvent) AggregateID() string   { return e.aggregateID }
func (e testEvent) OccurredAt() time.Time { return e.at }

func issued(aggregateID string, n int) domain.DomainEvent {
	return testEvent{name: "InvoiceIssued", aggregateID: aggregateID, at: time.Date(2026, 10, 24, 12, 0, n, 123_000_000, time.UTC)}
}

func mapper(event domain.DomainEvent) (outbox.IntegrationEvent, error) {
	if event.EventName() != "InvoiceIssued" {
		return outbox.IntegrationEvent{}, fmt.Errorf("%w: %s", outbox.ErrUnmappedEvent, event.EventName())
	}
	return outbox.IntegrationEvent{
		Type:          "billing.invoice.issued.v1",
		AggregateType: "invoice",
		Data:          map[string]any{"invoiceId": event.AggregateID(), "totalAmount": json.Number("15000.00")},
	}, nil
}

// fakeProducer records what the relay publishes.
type fakeProducer struct {
	mu      sync.Mutex
	calls   int
	records []outbox.Record
	ctxs    []context.Context
	failAt  int // 1-based number of the Produce call that fails; 0 means never
	onFail  func() error
	before  func(call int)
}

func (p *fakeProducer) Produce(ctx context.Context, record outbox.Record) error {
	p.mu.Lock()
	p.calls++
	call := p.calls
	before := p.before
	p.mu.Unlock()
	if before != nil {
		before(call)
	}

	p.mu.Lock()
	defer p.mu.Unlock()
	if p.failAt == call {
		return p.onFail()
	}
	p.records = append(p.records, record)
	p.ctxs = append(p.ctxs, ctx)
	return nil
}

func (p *fakeProducer) published() []outbox.Record {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]outbox.Record(nil), p.records...)
}

func header(record outbox.Record, key string) string {
	for _, h := range record.Headers {
		if h.Key == key {
			return h.Value
		}
	}
	return ""
}

type fixture struct {
	db    *persistence.Database
	store *outbox.Store
}

func newFixture(t *testing.T) fixture {
	t.Helper()
	url := testsupport.NewDatabase(t)
	if err := persistence.Migrate(context.Background(), url); err != nil {
		t.Fatal(err)
	}
	db, err := persistence.Open(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	return fixture{db: db, store: outbox.NewStore(db, mapper)}
}

func (f fixture) relay(producer outbox.Producer, batchSize int) *outbox.Relay {
	return outbox.NewRelay(f.db, producer, slog.New(slog.NewTextHandler(io.Discard, nil)), outbox.RelayOptions{
		BatchSize:    batchSize,
		PollInterval: 10 * time.Millisecond,
	})
}

func (f fixture) count(t *testing.T, where string) int {
	t.Helper()
	ctx := context.Background()
	var n int
	if err := f.db.Querier(ctx).QueryRow(ctx, "SELECT count(*) FROM outbox WHERE "+where).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// BOOT-10: the events are written in the caller's transaction.
func TestAppendWritesTheEventsInTheCallersTransaction(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	id := uuid.NewString()
	boom := errors.New("boom")

	err := f.db.WithinTransaction(ctx, func(ctx context.Context) error {
		if err := f.store.Append(ctx, []domain.DomainEvent{issued(id, 1), issued(id, 2)}); err != nil {
			return err
		}
		return boom
	})
	if !errors.Is(err, boom) {
		t.Fatalf("error = %v, want %v", err, boom)
	}
	if got := f.count(t, "true"); got != 0 {
		t.Fatalf("outbox rows after a rollback = %d, want 0", got)
	}

	err = f.db.WithinTransaction(ctx, func(ctx context.Context) error {
		return f.store.Append(ctx, []domain.DomainEvent{issued(id, 1), issued(id, 2)})
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := f.count(t, "published_at IS NULL"); got != 2 {
		t.Fatalf("pending outbox rows after a commit = %d, want 2", got)
	}
}

func TestAppendStoresTheIntegrationEventNotTheDomainEvent(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	id := uuid.NewString()

	if err := f.store.Append(ctx, []domain.DomainEvent{issued(id, 1)}); err != nil {
		t.Fatal(err)
	}

	var aggregateType, aggregateID, eventType string
	var payload []byte
	err := f.db.Querier(ctx).QueryRow(ctx, `SELECT aggregate_type, aggregate_id::text, event_type, payload FROM outbox`).
		Scan(&aggregateType, &aggregateID, &eventType, &payload)
	if err != nil {
		t.Fatal(err)
	}
	if aggregateType != "invoice" || aggregateID != id || eventType != "billing.invoice.issued.v1" {
		t.Errorf("row = (%s, %s, %s), want (invoice, %s, billing.invoice.issued.v1)", aggregateType, aggregateID, eventType, id)
	}
	var data map[string]any
	if err := json.Unmarshal(payload, &data); err != nil {
		t.Fatal(err)
	}
	if data["invoiceId"] != id || data["totalAmount"] != 15000.0 {
		t.Errorf("payload = %s, want invoiceId %s and totalAmount 15000", payload, id)
	}
}

// BOOT-10: an event without a mapping fails the append and writes nothing.
func TestAppendWritesNothingWhenAnEventHasNoMapping(t *testing.T) {
	f := newFixture(t)
	id := uuid.NewString()

	err := f.store.Append(context.Background(), []domain.DomainEvent{
		issued(id, 1),
		testEvent{name: "InvoiceRenamed", aggregateID: id, at: time.Now()},
	})

	if !errors.Is(err, outbox.ErrUnmappedEvent) {
		t.Fatalf("Append() error = %v, want it to wrap ErrUnmappedEvent", err)
	}
	if got := f.count(t, "true"); got != 0 {
		t.Fatalf("outbox rows = %d, want 0: even the mapped event must not be written", got)
	}
}

// BOOT-10: topic = event type, key = aggregate id, CloudEvents binary headers, in sequence order.
func TestRelayPublishesInOrderWithTopicKeyAndCloudEventsHeaders(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	a, b := uuid.NewString(), uuid.NewString()
	if err := f.store.Append(ctx, []domain.DomainEvent{issued(a, 1), issued(b, 2), issued(a, 3)}); err != nil {
		t.Fatal(err)
	}
	producer := &fakeProducer{}

	published, err := f.relay(producer, 100).PublishPending(ctx)

	if err != nil || published != 3 {
		t.Fatalf("PublishPending() = (%d, %v), want (3, nil)", published, err)
	}
	records := producer.published()
	if len(records) != 3 {
		t.Fatalf("published %d records, want 3", len(records))
	}
	for i, wantKey := range []string{a, b, a} {
		record := records[i]
		if record.Topic != "billing.invoice.issued.v1" || record.Key != wantKey {
			t.Errorf("record %d = topic %q key %q, want topic billing.invoice.issued.v1 key %s", i, record.Topic, record.Key, wantKey)
		}
		var data map[string]any
		if err := json.Unmarshal(record.Value, &data); err != nil || data["invoiceId"] != wantKey {
			t.Errorf("record %d value = %s, want JSON with invoiceId %s", i, record.Value, wantKey)
		}
		if got := header(record, "ce_specversion"); got != "1.0" {
			t.Errorf("record %d ce_specversion = %q, want 1.0", i, got)
		}
		if got := header(record, "ce_source"); got != "/billing-service" {
			t.Errorf("record %d ce_source = %q, want /billing-service", i, got)
		}
		if got := header(record, "ce_type"); got != "billing.invoice.issued.v1" {
			t.Errorf("record %d ce_type = %q, want billing.invoice.issued.v1", i, got)
		}
		if got := header(record, "ce_subject"); got != wantKey {
			t.Errorf("record %d ce_subject = %q, want %s", i, got, wantKey)
		}
		if got := header(record, "content-type"); got != "application/json" {
			t.Errorf("record %d content-type = %q, want application/json", i, got)
		}
	}

	if got, want := header(records[0], "ce_time"), "2026-10-24T12:00:01.123Z"; got != want {
		t.Errorf("ce_time = %q, want %q", got, want)
	}
	var firstEventID string
	if err := f.db.Querier(ctx).QueryRow(ctx, `SELECT event_id::text FROM outbox ORDER BY sequence LIMIT 1`).Scan(&firstEventID); err != nil {
		t.Fatal(err)
	}
	if got := header(records[0], "ce_id"); got != firstEventID {
		t.Errorf("ce_id = %q, want the outbox event_id %s", got, firstEventID)
	}

	if got := f.count(t, "published_at IS NULL"); got != 0 {
		t.Errorf("pending rows after publishing = %d, want 0", got)
	}
	again, err := f.relay(producer, 100).PublishPending(ctx)
	if err != nil || again != 0 || len(producer.published()) != 3 {
		t.Errorf("a second PublishPending() = (%d, %v) with %d records in total, want (0, nil) and 3", again, err, len(producer.published()))
	}
}

// BOOT-10: a producer failure leaves that event and the later ones pending, and the earlier ones published.
func TestRelayLeavesTheFailedEventAndTheLaterOnesPending(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	ids := []string{uuid.NewString(), uuid.NewString(), uuid.NewString()}
	if err := f.store.Append(ctx, []domain.DomainEvent{issued(ids[0], 1), issued(ids[1], 2), issued(ids[2], 3)}); err != nil {
		t.Fatal(err)
	}
	broker := errors.New("broker unavailable")
	producer := &fakeProducer{failAt: 2, onFail: func() error { return broker }}

	published, err := f.relay(producer, 100).PublishPending(ctx)

	if !errors.Is(err, broker) || published != 1 {
		t.Fatalf("PublishPending() = (%d, %v), want (1, %v)", published, err, broker)
	}
	if got := f.count(t, "published_at IS NOT NULL"); got != 1 {
		t.Fatalf("published rows = %d, want 1", got)
	}

	producer.failAt = 0
	published, err = f.relay(producer, 100).PublishPending(ctx)

	if err != nil || published != 2 {
		t.Fatalf("retry PublishPending() = (%d, %v), want (2, nil)", published, err)
	}
	var keys []string
	for _, record := range producer.published() {
		keys = append(keys, record.Key)
	}
	if fmt.Sprint(keys) != fmt.Sprint(ids) {
		t.Fatalf("published keys = %v, want %v: each event once, in order", keys, ids)
	}
}

// BOOT-06: what was sent before a shutdown is still marked as published.
func TestRelayMarksWhatWasSentEvenWhenCancelledMidBatch(t *testing.T) {
	f := newFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ids := []string{uuid.NewString(), uuid.NewString(), uuid.NewString()}
	if err := f.store.Append(ctx, []domain.DomainEvent{issued(ids[0], 1), issued(ids[1], 2), issued(ids[2], 3)}); err != nil {
		t.Fatal(err)
	}
	producer := &fakeProducer{failAt: 2, onFail: func() error { cancel(); return context.Canceled }}

	published, err := f.relay(producer, 100).PublishPending(ctx)

	if err == nil || published != 1 {
		t.Fatalf("PublishPending() = (%d, %v), want (1, an error)", published, err)
	}
	if got := f.count(t, "published_at IS NOT NULL"); got != 1 {
		t.Fatalf("published rows after the cancellation = %d, want 1", got)
	}
}

// Design: the relay locks its batch with SKIP LOCKED, so two instances never publish the same event.
func TestConcurrentRelaysSkipTheRowsAnotherOneHasLocked(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	var events []domain.DomainEvent
	for n := 1; n <= 4; n++ {
		events = append(events, issued(uuid.NewString(), n))
	}
	if err := f.store.Append(ctx, events); err != nil {
		t.Fatal(err)
	}

	holding, release := make(chan struct{}), make(chan struct{})
	slow := &fakeProducer{before: func(call int) {
		if call == 1 {
			close(holding)
			<-release
		}
	}}
	slowDone := make(chan error, 1)
	go func() {
		_, err := f.relay(slow, 2).PublishPending(ctx)
		slowDone <- err
	}()
	<-holding

	fast := &fakeProducer{}
	type outcome struct {
		published int
		err       error
	}
	fastDone := make(chan outcome, 1)
	go func() {
		published, err := f.relay(fast, 2).PublishPending(ctx)
		fastDone <- outcome{published, err}
	}()
	select {
	case got := <-fastDone:
		if got.err != nil || got.published != 2 {
			t.Fatalf("second relay PublishPending() = (%d, %v), want (2, nil): it must take the 2 rows the first one did not lock", got.published, got.err)
		}
	case <-time.After(5 * time.Second):
		close(release)
		t.Fatal("the second relay is stuck behind the rows the first one locked: the batch must be selected with SKIP LOCKED")
	}

	close(release)
	if err := <-slowDone; err != nil {
		t.Fatal(err)
	}
	seen := map[string]int{}
	for _, record := range append(slow.published(), fast.published()...) {
		seen[record.Key]++
	}
	if len(seen) != 4 {
		t.Fatalf("published %d distinct events, want 4", len(seen))
	}
	for key, n := range seen {
		if n != 1 {
			t.Errorf("event %s published %d times, want 1", key, n)
		}
	}
}

// Success criterion: one trace goes from the consumed event to the published one.
func TestRelayContinuesTheTraceOfTheRequestThatWroteTheEvent(t *testing.T) {
	f := newFixture(t)
	traceID, _ := trace.TraceIDFromHex("4bf92f3577b34da6a3ce929d0e0e4736")
	spanID, _ := trace.SpanIDFromHex("00f067aa0ba902b7")
	writeCtx := trace.ContextWithSpanContext(context.Background(), trace.NewSpanContext(trace.SpanContextConfig{
		TraceID: traceID, SpanID: spanID, TraceFlags: trace.FlagsSampled, Remote: true,
	}))
	if err := f.store.Append(writeCtx, []domain.DomainEvent{issued(uuid.NewString(), 1)}); err != nil {
		t.Fatal(err)
	}
	producer := &fakeProducer{}

	// The relay runs later, in another context that knows nothing about the request.
	if _, err := f.relay(producer, 100).PublishPending(context.Background()); err != nil {
		t.Fatal(err)
	}

	got := trace.SpanContextFromContext(producer.ctxs[0])
	if got.TraceID() != traceID || got.SpanID() != spanID || !got.IsRemote() {
		t.Fatalf("producer context span = trace %s span %s remote %v, want trace %s span %s remote true",
			got.TraceID(), got.SpanID(), got.IsRemote(), traceID, spanID)
	}
}

func TestRunPublishesNewEventsUntilCancelled(t *testing.T) {
	f := newFixture(t)
	producer := &fakeProducer{}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- f.relay(producer, 100).Run(ctx) }()

	if err := f.store.Append(context.Background(), []domain.DomainEvent{issued(uuid.NewString(), 1)}); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for len(producer.published()) == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if len(producer.published()) != 1 {
		t.Fatalf("Run published %d events, want 1 within 5s", len(producer.published()))
	}

	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Run() error = %v, want nil after cancellation", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not return within 2s of the cancellation")
	}
}
