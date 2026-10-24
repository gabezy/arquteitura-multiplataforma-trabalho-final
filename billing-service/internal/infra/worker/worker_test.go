package worker_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/port/in"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/port/out"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/worker"
)

// logs collects what a worker logs, as text with the level.
type logs struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (l *logs) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.buf.Write(p)
}

func (l *logs) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.buf.String()
}

func newLogger() (*slog.Logger, *logs) {
	collected := &logs{}
	return slog.New(slog.NewTextHandler(collected, nil)), collected
}

// fakePayments answers each call with the next outcome, and NoneDue once they run out.
type fakePayments struct {
	mu       sync.Mutex
	outcomes []in.PaymentOutcome
	failOn   int
	err      error
	onCall   func(n int)
	calls    int
}

func (f *fakePayments) RequestNextPayment(context.Context) (in.PaymentOutcome, error) {
	f.mu.Lock()
	f.calls++
	n := f.calls
	f.mu.Unlock()
	if f.onCall != nil {
		f.onCall(n)
	}
	if n == f.failOn {
		return "", f.err
	}
	if n <= len(f.outcomes) {
		return f.outcomes[n-1], nil
	}
	return in.NoneDue, nil
}

func (f *fakePayments) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

func waitFor(t *testing.T, what string, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for !condition() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(time.Millisecond)
	}
}

// stops runs the loop and returns what it takes to end it: cancel, and the error Run returned.
func stops(run func(ctx context.Context) error) (cancel func(), result <-chan error) {
	ctx, cancelContext := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- run(ctx) }()
	return cancelContext, done
}

func expectNil(t *testing.T, result <-chan error) {
	t.Helper()
	select {
	case err := <-result:
		if err != nil {
			t.Fatalf("Run() = %v, want nil on cancellation", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Run() did not return after the context ended")
	}
}

// PAY-01: every invoice that is due is charged, one after the other, in the same round.
func TestPaymentWorkerChargesEveryDueInvoiceInOneRound(t *testing.T) {
	payments := &fakePayments{outcomes: []in.PaymentOutcome{in.Pending, in.Refused, in.Pending, in.NoneDue}}
	logger, collected := newLogger()

	worker.NewPaymentWorker(payments, time.Hour, logger).RunOnce(context.Background())

	if payments.count() != 4 {
		t.Fatalf("RequestNextPayment was called %d times, want 4: until none is due", payments.count())
	}
	if collected.String() != "" {
		t.Errorf("a normal round logged %q, want nothing", collected)
	}
}

func TestPaymentWorkerDoesNothingWhenNoInvoiceIsDue(t *testing.T) {
	payments := &fakePayments{}

	worker.NewPaymentWorker(payments, time.Hour, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))).RunOnce(context.Background())

	if payments.count() != 1 {
		t.Fatalf("RequestNextPayment was called %d times, want 1", payments.count())
	}
}

// PAY-10 and PAY-11: with the PSP unavailable the round ends, because the next invoice would meet the same wall.
func TestPaymentWorkerStopsTheRoundWhenThePSPIsUnavailable(t *testing.T) {
	payments := &fakePayments{outcomes: []in.PaymentOutcome{in.Pending, in.Postponed, in.Pending}}
	logger, collected := newLogger()

	worker.NewPaymentWorker(payments, time.Hour, logger).RunOnce(context.Background())

	if payments.count() != 2 {
		t.Fatalf("RequestNextPayment was called %d times, want 2: no more after the PSP was unavailable", payments.count())
	}
	if !strings.Contains(collected.String(), "level=WARN") || strings.Contains(collected.String(), "level=ERROR") {
		t.Errorf("log %q, want a warning and no error for an unavailable PSP", collected)
	}
}

func TestPaymentWorkerStopsTheRoundAndLogsAnErrorWhenSomethingUnexpectedHappens(t *testing.T) {
	payments := &fakePayments{outcomes: []in.PaymentOutcome{in.Pending, in.Pending, in.Pending}, failOn: 2, err: errors.New("database is down")}
	logger, collected := newLogger()

	worker.NewPaymentWorker(payments, time.Hour, logger).RunOnce(context.Background())

	if payments.count() != 2 {
		t.Fatalf("RequestNextPayment was called %d times, want 2", payments.count())
	}
	if !strings.Contains(collected.String(), "level=ERROR") || !strings.Contains(collected.String(), "database is down") {
		t.Errorf("log %q, want an error with the cause", collected)
	}
}

func TestPaymentWorkerStopsTheRoundWhenItsContextEnds(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	payments := &fakePayments{outcomes: make([]in.PaymentOutcome, 100), onCall: func(n int) {
		if n == 3 {
			cancel()
		}
	}}
	for i := range payments.outcomes {
		payments.outcomes[i] = in.Pending
	}

	worker.NewPaymentWorker(payments, time.Hour, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))).RunOnce(ctx)

	if payments.count() != 3 {
		t.Fatalf("RequestNextPayment was called %d times, want 3: none after the context ended", payments.count())
	}
}

func TestPaymentWorkerDoesNotReportAShutdownAsAnError(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	payments := &fakePayments{failOn: 1, err: context.Canceled, onCall: func(int) { cancel() }}
	logger, collected := newLogger()

	worker.NewPaymentWorker(payments, time.Hour, logger).RunOnce(ctx)

	if collected.String() != "" {
		t.Errorf("a shutdown logged %q, want nothing", collected)
	}
}

func TestPaymentWorkerRunsARoundEveryInterval(t *testing.T) {
	payments := &fakePayments{}
	logger, _ := newLogger()
	cancel, result := stops(worker.NewPaymentWorker(payments, 5*time.Millisecond, logger).Run)

	waitFor(t, "three rounds", func() bool { return payments.count() >= 3 })
	cancel()

	expectNil(t, result)
}

func TestPaymentWorkerWaitsOneIntervalBeforeItsFirstRound(t *testing.T) {
	payments := &fakePayments{}
	logger, _ := newLogger()
	cancel, result := stops(worker.NewPaymentWorker(payments, 10*time.Second, logger).Run)

	time.Sleep(100 * time.Millisecond)
	if payments.count() != 0 {
		t.Errorf("RequestNextPayment was called %d times within 100ms of a 10s interval, want 0", payments.count())
	}
	cancel()

	expectNil(t, result)
}

// fakeReconciler returns what it was given on every call.
type fakeReconciler struct {
	mu       sync.Mutex
	resolved int
	err      error
	onCall   func()
	calls    int
}

func (f *fakeReconciler) ReconcilePendingPayments(context.Context) (int, error) {
	f.mu.Lock()
	f.calls++
	f.mu.Unlock()
	if f.onCall != nil {
		f.onCall()
	}
	return f.resolved, f.err
}

func (f *fakeReconciler) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

// REC-01: the reconciliation reports what it resolved, and stays quiet when there was nothing to do.
func TestReconciliationWorkerReportsWhatItResolved(t *testing.T) {
	reconciler := &fakeReconciler{resolved: 2}
	logger, collected := newLogger()

	worker.NewReconciliationWorker(reconciler, time.Hour, logger).RunOnce(context.Background())

	if reconciler.count() != 1 {
		t.Fatalf("ReconcilePendingPayments was called %d times, want 1", reconciler.count())
	}
	if !strings.Contains(collected.String(), "level=INFO") || !strings.Contains(collected.String(), "resolved=2") {
		t.Errorf("log %q, want an info line with resolved=2", collected)
	}
}

func TestReconciliationWorkerIsQuietWhenNothingWasPending(t *testing.T) {
	logger, collected := newLogger()

	worker.NewReconciliationWorker(&fakeReconciler{}, time.Hour, logger).RunOnce(context.Background())

	if collected.String() != "" {
		t.Errorf("log %q, want nothing", collected)
	}
}

func TestReconciliationWorkerTellsAnUnavailablePSPFromAFailure(t *testing.T) {
	tests := []struct {
		name      string
		err       error
		wantLevel string
		notLevel  string
	}{
		{"an unavailable PSP", fmt.Errorf("get charge: %w", out.ErrUnavailable), "level=WARN", "level=ERROR"},
		{"anything else", errors.New("database is down"), "level=ERROR", "level=WARN"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			logger, collected := newLogger()

			worker.NewReconciliationWorker(&fakeReconciler{resolved: 1, err: tt.err}, time.Hour, logger).RunOnce(context.Background())

			if !strings.Contains(collected.String(), tt.wantLevel) || strings.Contains(collected.String(), tt.notLevel) {
				t.Errorf("log %q, want %s and not %s", collected, tt.wantLevel, tt.notLevel)
			}
			if !strings.Contains(collected.String(), tt.err.Error()) || !strings.Contains(collected.String(), "resolved=1") {
				t.Errorf("log %q, want the cause and what was resolved before it", collected)
			}
		})
	}
}

func TestReconciliationWorkerDoesNotReportAShutdownAsAnError(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reconciler := &fakeReconciler{err: context.Canceled, onCall: cancel}
	logger, collected := newLogger()

	worker.NewReconciliationWorker(reconciler, time.Hour, logger).RunOnce(ctx)

	if collected.String() != "" {
		t.Errorf("a shutdown logged %q, want nothing", collected)
	}
}

func TestReconciliationWorkerRunsEveryIntervalUntilItsContextEnds(t *testing.T) {
	reconciler := &fakeReconciler{}
	logger, _ := newLogger()
	cancel, result := stops(worker.NewReconciliationWorker(reconciler, 5*time.Millisecond, logger).Run)

	waitFor(t, "three rounds", func() bool { return reconciler.count() >= 3 })
	cancel()

	expectNil(t, result)
}
