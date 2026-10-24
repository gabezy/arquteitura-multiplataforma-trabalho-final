package messaging

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/plugin/kotel"
)

type scriptedHandler struct {
	results []error // one per call, in order; nil once the script is used up
	calls   int
}

func (h *scriptedHandler) Handle(context.Context, Message) error {
	h.calls++
	if h.calls <= len(h.results) {
		return h.results[h.calls-1]
	}
	return nil
}

type recordedDeadLetter struct {
	message Message
	reason  string
}

type scriptedDeadLetter struct {
	errs      []error
	attempts  int
	published []recordedDeadLetter
}

func (d *scriptedDeadLetter) Publish(_ context.Context, message Message, reason string) error {
	d.attempts++
	if d.attempts <= len(d.errs) && d.errs[d.attempts-1] != nil {
		return d.errs[d.attempts-1]
	}
	d.published = append(d.published, recordedDeadLetter{message: message, reason: reason})
	return nil
}

// sleeper records the delays instead of waiting, and cancels the context after cancelAfter sleeps.
type sleeper struct {
	delays      []time.Duration
	cancelAfter int
	cancel      context.CancelFunc
}

func (s *sleeper) sleep(ctx context.Context, delay time.Duration) error {
	s.delays = append(s.delays, delay)
	if s.cancelAfter > 0 && len(s.delays) >= s.cancelAfter {
		s.cancel()
	}
	return ctx.Err()
}

func newTestConsumer(handler MessageHandler, dead DeadLetter, s *sleeper) *OrderEventsConsumer {
	return &OrderEventsConsumer{handler: handler, dead: dead, sleep: s.sleep, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
}

var anyMessage = Message{Topic: "order.order.confirmed.v1", Partition: 2, Offset: 7, Key: []byte("k"), Value: []byte("{}")}

// INV-07: a transient failure is retried with a backoff that starts at 1 s and doubles up to 30 s.
func TestProcessRetriesATransientFailureWithDoublingBackoffCappedAtThirtySeconds(t *testing.T) {
	down := errors.New("database down")
	handler := &scriptedHandler{results: []error{down, down, down, down, down, down, down}}
	dead := &scriptedDeadLetter{}
	s := &sleeper{}

	err := newTestConsumer(handler, dead, s).process(context.Background(), anyMessage)

	if err != nil {
		t.Fatalf("process() error = %v, want nil once the message succeeds", err)
	}
	want := []time.Duration{time.Second, 2 * time.Second, 4 * time.Second, 8 * time.Second, 16 * time.Second, 30 * time.Second, 30 * time.Second}
	if !slices.Equal(s.delays, want) {
		t.Fatalf("delays = %v, want %v", s.delays, want)
	}
	if handler.calls != 8 || len(dead.published) != 0 {
		t.Fatalf("handler calls = %d, dead letters = %d, want 8 and 0: a transient failure is never dead-lettered", handler.calls, len(dead.published))
	}
}

// INV-06: a message that can never succeed goes to the dead letter, once, and is done.
func TestProcessSendsAnUnprocessableMessageToTheDeadLetter(t *testing.T) {
	handler := &scriptedHandler{results: []error{&UnprocessableError{Reason: "orderId must be a UUID"}}}
	dead := &scriptedDeadLetter{}
	s := &sleeper{}

	err := newTestConsumer(handler, dead, s).process(context.Background(), anyMessage)

	if err != nil {
		t.Fatalf("process() error = %v, want nil so that the offset is committed", err)
	}
	if len(dead.published) != 1 || dead.published[0].reason != "orderId must be a UUID" || dead.published[0].message.Offset != 7 || dead.published[0].message.Partition != 2 {
		t.Fatalf("dead letters = %+v, want the message at partition 2 offset 7 with its reason", dead.published)
	}
	if handler.calls != 1 || len(s.delays) != 0 {
		t.Fatalf("handler calls = %d, sleeps = %v, want 1 and none", handler.calls, s.delays)
	}
}

// INV-06 and INV-07: if the dead letter cannot be written, the offset is not committed: it is retried.
func TestProcessRetriesTheDeadLetterPublishWithBackoff(t *testing.T) {
	handler := &scriptedHandler{results: []error{
		&UnprocessableError{Reason: "bad"}, &UnprocessableError{Reason: "bad"}, &UnprocessableError{Reason: "bad"},
	}}
	dead := &scriptedDeadLetter{errs: []error{errors.New("kafka down"), errors.New("kafka down")}}
	s := &sleeper{}

	err := newTestConsumer(handler, dead, s).process(context.Background(), anyMessage)

	if err != nil {
		t.Fatalf("process() error = %v, want nil", err)
	}
	if want := []time.Duration{time.Second, 2 * time.Second}; !slices.Equal(s.delays, want) {
		t.Fatalf("delays = %v, want %v", s.delays, want)
	}
	if len(dead.published) != 1 {
		t.Fatalf("published %d dead letters, want exactly 1", len(dead.published))
	}
}

// INV-07: the offset is not committed while the message keeps failing, and shutdown interrupts the wait.
func TestProcessStopsWithAnErrorWhenTheContextEndsWhileWaiting(t *testing.T) {
	down := errors.New("database down")
	handler := &scriptedHandler{results: []error{down, down, down, down, down}}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s := &sleeper{cancelAfter: 2, cancel: cancel}

	err := newTestConsumer(handler, &scriptedDeadLetter{}, s).process(ctx, anyMessage)

	if !errors.Is(err, context.Canceled) {
		t.Fatalf("process() error = %v, want context.Canceled so that the caller does not commit", err)
	}
	if handler.calls != 2 {
		t.Fatalf("handler calls = %d, want 2: no attempt after the shutdown", handler.calls)
	}
}

func TestProcessDoesNotStartWhenTheContextIsAlreadyCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	handler := &scriptedHandler{results: []error{errors.New("down")}}

	err := newTestConsumer(handler, &scriptedDeadLetter{}, &sleeper{}).process(ctx, anyMessage)

	if !errors.Is(err, context.Canceled) {
		t.Fatalf("process() error = %v, want context.Canceled", err)
	}
}

func TestMessageOfCopiesTheRecord(t *testing.T) {
	record := &kgo.Record{
		Topic: "order.order.cancelled.v1", Partition: 3, Offset: 99, Key: []byte("k"), Value: []byte("v"),
		Headers: []kgo.RecordHeader{{Key: "ce_id", Value: []byte("evt-9")}, {Key: "ce_type", Value: []byte("t")}},
	}

	got := messageOf(record)

	if got.Topic != "order.order.cancelled.v1" || got.Partition != 3 || got.Offset != 99 || string(got.Key) != "k" || string(got.Value) != "v" {
		t.Fatalf("message = %+v", got)
	}
	if len(got.Headers) != 2 || got.Headers[0].Key != "ce_id" || string(got.Headers[0].Value) != "evt-9" {
		t.Fatalf("headers = %+v, want the two record headers", got.Headers)
	}
}

type recordingCommitter struct {
	committed []*kgo.Record
	err       error
}

func (c *recordingCommitter) CommitRecords(_ context.Context, records ...*kgo.Record) error {
	c.committed = append(c.committed, records...)
	return c.err
}

// handlerFunc is a MessageHandler made of a function.
type handlerFunc func(ctx context.Context, message Message) error

func (f handlerFunc) Handle(ctx context.Context, message Message) error { return f(ctx, message) }

func committingConsumer(handler MessageHandler, dead DeadLetter, s *sleeper, committer offsetCommitter, logs io.Writer) *OrderEventsConsumer {
	return &OrderEventsConsumer{
		committer: committer, tracer: kotel.NewTracer(), handler: handler, dead: dead, sleep: s.sleep,
		logger: slog.New(slog.NewTextHandler(logs, nil)),
	}
}

var anyRecord = &kgo.Record{Topic: "order.order.confirmed.v1", Partition: 2, Offset: 7, Key: []byte("k"), Value: []byte("{}")}

// INV-06: a message that was processed, or sent to the dead letter, has its offset committed.
func TestProcessRecordCommitsTheOffsetOfAMessageThatIsDone(t *testing.T) {
	tests := []struct {
		name    string
		handler MessageHandler
	}{
		{"processed", &scriptedHandler{}},
		{"dead-lettered", &scriptedHandler{results: []error{&UnprocessableError{Reason: "bad"}}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			committer := &recordingCommitter{}

			err := committingConsumer(tt.handler, &scriptedDeadLetter{}, &sleeper{}, committer, io.Discard).processRecord(context.Background(), anyRecord)

			if err != nil {
				t.Fatalf("processRecord() error = %v, want nil", err)
			}
			if len(committer.committed) != 1 || committer.committed[0] != anyRecord {
				t.Fatalf("committed %v, want the record of partition 2 offset 7, once", committer.committed)
			}
		})
	}
}

// INV-07: while a message keeps failing its offset is not committed, so the next instance takes it again.
func TestProcessRecordDoesNotCommitTheOffsetOfAMessageThatKeepsFailing(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	down := errors.New("database down")
	handler := &scriptedHandler{results: []error{down, down, down, down}}
	committer := &recordingCommitter{}
	s := &sleeper{cancelAfter: 2, cancel: cancel}

	err := committingConsumer(handler, &scriptedDeadLetter{}, s, committer, io.Discard).processRecord(ctx, anyRecord)

	if !errors.Is(err, context.Canceled) {
		t.Fatalf("processRecord() error = %v, want the context error that ended the retries", err)
	}
	if len(committer.committed) != 0 {
		t.Fatalf("committed %v while the message was still failing, want nothing", committer.committed)
	}
}

func TestProcessRecordCommitsOnlyAfterTheMessageWasHandled(t *testing.T) {
	committer := &recordingCommitter{}
	var committedWhileHandling int
	handler := handlerFunc(func(context.Context, Message) error {
		committedWhileHandling = len(committer.committed)
		return nil
	})

	if err := committingConsumer(handler, &scriptedDeadLetter{}, &sleeper{}, committer, io.Discard).processRecord(context.Background(), anyRecord); err != nil {
		t.Fatal(err)
	}

	if committedWhileHandling != 0 || len(committer.committed) != 1 {
		t.Fatalf("commits while handling = %d, after = %d, want 0 and 1", committedWhileHandling, len(committer.committed))
	}
}

// A commit that fails is logged and the consumer goes on: the message is delivered again, and the inbox makes that harmless.
func TestProcessRecordLogsAFailedCommitAndGoesOn(t *testing.T) {
	var logs bytes.Buffer
	committer := &recordingCommitter{err: errors.New("broker unavailable")}

	err := committingConsumer(&scriptedHandler{}, &scriptedDeadLetter{}, &sleeper{}, committer, &logs).processRecord(context.Background(), anyRecord)

	if err != nil {
		t.Fatalf("processRecord() error = %v, want nil", err)
	}
	if !strings.Contains(logs.String(), "level=ERROR") || !strings.Contains(logs.String(), "broker unavailable") || !strings.Contains(logs.String(), "offset=7") {
		t.Errorf("log %q, want an error with the offset and the cause", logs.String())
	}
}
