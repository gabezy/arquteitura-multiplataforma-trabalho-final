package persistence_test

import (
	"context"
	"errors"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/model"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/shared/domain"
)

func saveNew(t *testing.T, f repositoryFixture, marketplace model.Marketplace, at time.Time) *model.Invoice {
	t.Helper()
	invoice := newInvoice(t, marketplace, at)
	if err := f.invoices.Save(context.Background(), invoice); err != nil {
		t.Fatal(err)
	}
	return invoice
}

func reload(t *testing.T, f repositoryFixture, id string) *model.Invoice {
	t.Helper()
	invoice, err := f.invoices.FindByID(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	return invoice
}

func idsOf(snapshots []model.Snapshot) []string {
	ids := make([]string, len(snapshots))
	for i, s := range snapshots {
		ids[i] = s.ID
	}
	return ids
}

func timesEqual(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == b
	}
	return a.Equal(*b)
}

// The payment columns round trip through every transition of the invoice.
func TestSaveStoresThePaymentFieldsOfEveryTransition(t *testing.T) {
	f := newRepositoryFixture(t, &recordingAppender{})
	ctx := context.Background()
	at := base.Add(time.Minute)

	t.Run("a failed attempt", func(t *testing.T) {
		invoice := reload(t, f, saveNew(t, f, model.Amazon, base).ID())
		invoice.PaymentAttemptFailed(at)
		if err := f.invoices.Save(ctx, invoice); err != nil {
			t.Fatal(err)
		}

		got := reload(t, f, invoice.ID()).Snapshot()

		if got.Status != model.StatusIssued || got.PaymentAttempts != 1 || !timesEqual(got.NextPaymentAttemptAt, invoice.Snapshot().NextPaymentAttemptAt) || got.NextPaymentAttemptAt == nil {
			t.Fatalf("snapshot = status %q attempts %d next %v, want ISSUED, 1 attempt and the stored next attempt", got.Status, got.PaymentAttempts, got.NextPaymentAttemptAt)
		}
	})

	t.Run("the PSP accepted the charge and then reported the payment", func(t *testing.T) {
		invoice := reload(t, f, saveNew(t, f, model.Amazon, base).ID())
		if err := invoice.MarkPaymentPending("ch_paid_one", at); err != nil {
			t.Fatal(err)
		}
		if err := f.invoices.Save(ctx, invoice); err != nil {
			t.Fatal(err)
		}
		pending := reload(t, f, invoice.ID()).Snapshot()
		if pending.Status != model.StatusPaymentPending || pending.PSPTransactionID != "ch_paid_one" || pending.PaymentRequestedAt == nil || !pending.PaymentRequestedAt.Equal(at) || pending.NextPaymentAttemptAt != nil {
			t.Fatalf("pending snapshot = %+v", pending)
		}

		loaded := reload(t, f, invoice.ID())
		if _, err := loaded.ConfirmPayment("ch_paid_one", at.Add(time.Second)); err != nil {
			t.Fatal(err)
		}
		if err := f.invoices.Save(ctx, loaded); err != nil {
			t.Fatal(err)
		}
		paid := reload(t, f, invoice.ID()).Snapshot()
		if paid.Status != model.StatusPaid || paid.PaidAt == nil || !paid.PaidAt.Equal(at.Add(time.Second)) || paid.PSPTransactionID != "ch_paid_one" || paid.Version != 3 {
			t.Fatalf("paid snapshot = status %q paidAt %v charge %q version %d, want PAID, the time, ch_paid_one and version 3", paid.Status, paid.PaidAt, paid.PSPTransactionID, paid.Version)
		}
	})

	t.Run("a refusal without a charge", func(t *testing.T) {
		invoice := reload(t, f, saveNew(t, f, model.Amazon, base).ID())
		if _, err := invoice.FailPayment("", "AMOUNT_NOT_ALLOWED", at); err != nil {
			t.Fatal(err)
		}
		if err := f.invoices.Save(ctx, invoice); err != nil {
			t.Fatal(err)
		}

		got := reload(t, f, invoice.ID()).Snapshot()

		if got.Status != model.StatusPaymentFailed || got.FailureReason != "AMOUNT_NOT_ALLOWED" || got.PSPTransactionID != "" || got.FailedAt == nil || !got.FailedAt.Equal(at) {
			t.Fatalf("snapshot = status %q reason %q charge %q failedAt %v", got.Status, got.FailureReason, got.PSPTransactionID, got.FailedAt)
		}
	})
}

// PAY-08: a charge belongs to one invoice only.
func TestSaveRejectsTheSameChargeOnTwoInvoicesWithAConflictError(t *testing.T) {
	f := newRepositoryFixture(t, &recordingAppender{})
	ctx := context.Background()
	first := reload(t, f, saveNew(t, f, model.Amazon, base).ID())
	second := reload(t, f, saveNew(t, f, model.Shopee, base.Add(time.Second)).ID())
	if err := first.MarkPaymentPending("ch_paid_same", base); err != nil {
		t.Fatal(err)
	}
	if err := f.invoices.Save(ctx, first); err != nil {
		t.Fatal(err)
	}
	if err := second.MarkPaymentPending("ch_paid_same", base); err != nil {
		t.Fatal(err)
	}

	err := f.invoices.Save(ctx, second)

	var conflict *domain.ConflictError
	if !errors.As(err, &conflict) {
		t.Fatalf("Save() error = %v, want a ConflictError", err)
	}
}

// PAY-01: the oldest issued invoice whose attempt is due, and only that one.
func TestLockNextDueReturnsTheOldestDueIssuedInvoice(t *testing.T) {
	f := newRepositoryFixture(t, &recordingAppender{})
	ctx := context.Background()
	retried := reload(t, f, saveNew(t, f, model.Amazon, base.Add(2*time.Minute)).ID()) // failed before, its next attempt is due exactly now
	retried.PaymentAttemptFailed(base)
	if err := f.invoices.Save(ctx, retried); err != nil {
		t.Fatal(err)
	}
	now := *retried.Snapshot().NextPaymentAttemptAt
	older := saveNew(t, f, model.Amazon, base)
	newer := saveNew(t, f, model.Shopee, base.Add(time.Minute))
	waiting := reload(t, f, saveNew(t, f, model.Amazon, base.Add(-time.Hour)).ID()) // the oldest, but its next attempt is in the future
	waiting.PaymentAttemptFailed(now.Add(time.Minute))
	if err := f.invoices.Save(ctx, waiting); err != nil {
		t.Fatal(err)
	}
	pending := reload(t, f, saveNew(t, f, model.Amazon, base.Add(-2*time.Hour)).ID())
	if err := pending.MarkPaymentPending("ch_paid_p", base); err != nil {
		t.Fatal(err)
	}
	if err := f.invoices.Save(ctx, pending); err != nil {
		t.Fatal(err)
	}

	var got []string
	for i := 0; i < 4; i++ {
		err := f.db.WithinTransaction(ctx, func(ctx context.Context) error {
			invoice, err := f.invoices.LockNextDue(ctx, now)
			if err != nil {
				return err
			}
			got = append(got, invoice.ID())
			// Taking it for payment moves it out of the due set.
			if err := invoice.MarkPaymentPending("ch_paid_"+invoice.ID(), now); err != nil {
				return err
			}
			return f.invoices.Save(ctx, invoice)
		})
		if i < 3 && err != nil {
			t.Fatalf("take %d: error = %v", i+1, err)
		}
		if i == 3 {
			var notFound *domain.NotFoundError
			if !errors.As(err, &notFound) {
				t.Fatalf("take 4: error = %v, want a NotFoundError: the invoice that waits and the one already pending are not due", err)
			}
		}
	}

	if want := []string{older.ID(), newer.ID(), retried.ID()}; !slices.Equal(got, want) {
		t.Fatalf("taken in the order %v, want %v: oldest first, the retry once its time has come, skipping the one that waits and the pending one", got, want)
	}
}

// Design: two instances never take the same invoice. The row lock is skipped, not waited for.
func TestLockNextDueSkipsAnInvoiceAnotherTransactionHasLocked(t *testing.T) {
	f := newRepositoryFixture(t, &recordingAppender{})
	ctx := context.Background()
	first := saveNew(t, f, model.Amazon, base)
	second := saveNew(t, f, model.Shopee, base.Add(time.Minute))
	now := base.Add(time.Hour)

	holding, release := make(chan string, 1), make(chan struct{})
	releaseHolder := sync.OnceFunc(func() { close(release) })
	defer releaseHolder() // a failing test must not leave the transaction open, or closing the pool waits for it
	holderDone := make(chan error, 1)
	go func() {
		holderDone <- f.db.WithinTransaction(ctx, func(ctx context.Context) error {
			invoice, err := f.invoices.LockNextDue(ctx, now)
			if err != nil {
				return err
			}
			holding <- invoice.ID()
			<-release
			return nil
		})
	}()
	select {
	case got := <-holding:
		if got != first.ID() {
			t.Fatalf("the first transaction locked %s, want the oldest, %s", got, first.ID())
		}
	case err := <-holderDone:
		t.Fatalf("the first transaction ended without locking an invoice: %v", err)
	}

	type result struct {
		id  string
		err error
	}
	other := make(chan result, 1)
	go func() {
		var id string
		err := f.db.WithinTransaction(ctx, func(ctx context.Context) error {
			invoice, err := f.invoices.LockNextDue(ctx, now)
			if err == nil {
				id = invoice.ID()
			}
			return err
		})
		other <- result{id, err}
	}()

	select {
	case got := <-other:
		if got.err != nil || got.id != second.ID() {
			t.Fatalf("the second transaction got (%q, %v), want the second invoice, %s", got.id, got.err, second.ID())
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the second transaction is stuck behind the lock of the first: LockNextDue must skip locked rows (SKIP LOCKED)")
	}
	releaseHolder()
	if err := <-holderDone; err != nil {
		t.Fatal(err)
	}
}

// Edge case: a webhook waits for the worker that holds the invoice, and applies on top of it.
func TestLockByIDWaitsForTheTransactionThatHoldsTheRow(t *testing.T) {
	f := newRepositoryFixture(t, &recordingAppender{})
	ctx := context.Background()
	invoice := saveNew(t, f, model.Amazon, base)

	holding, release := make(chan struct{}), make(chan struct{})
	releaseHolder := sync.OnceFunc(func() { close(release) })
	defer releaseHolder()
	holderDone := make(chan error, 1)
	go func() {
		holderDone <- f.db.WithinTransaction(ctx, func(ctx context.Context) error {
			if _, err := f.invoices.LockByID(ctx, invoice.ID()); err != nil {
				return err
			}
			close(holding)
			<-release
			return nil
		})
	}()
	select {
	case <-holding:
	case err := <-holderDone:
		t.Fatalf("the first transaction ended without locking the invoice: %v", err)
	}

	waiterDone := make(chan error, 1)
	go func() {
		waiterDone <- f.db.WithinTransaction(ctx, func(ctx context.Context) error {
			_, err := f.invoices.LockByID(ctx, invoice.ID())
			return err
		})
	}()

	select {
	case err := <-waiterDone:
		t.Fatalf("the second LockByID returned (%v) while the first transaction still held the row, want it to wait", err)
	case <-time.After(500 * time.Millisecond):
	}
	releaseHolder()
	select {
	case err := <-waiterDone:
		if err != nil {
			t.Fatalf("the waiting LockByID error = %v, want nil once the first transaction ends", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the waiting LockByID never got the row after the first transaction ended")
	}
	if err := <-holderDone; err != nil {
		t.Fatal(err)
	}
}

func TestLockByIDReturnsANotFoundErrorForUnknownInvoices(t *testing.T) {
	f := newRepositoryFixture(t, &recordingAppender{})
	ctx := context.Background()

	for _, id := range []string{uuid.NewString(), "not-a-uuid"} {
		err := f.db.WithinTransaction(ctx, func(ctx context.Context) error {
			_, err := f.invoices.LockByID(ctx, id)
			return err
		})
		var notFound *domain.NotFoundError
		if !errors.As(err, &notFound) {
			t.Errorf("LockByID(%q) error = %v, want a NotFoundError", id, err)
		}
	}
}

// REC-01: the charges pending since before the cutoff, oldest first, up to the limit.
func TestListPendingRequestedBeforeReturnsTheOldPendingChargesOldestFirst(t *testing.T) {
	f := newRepositoryFixture(t, &recordingAppender{})
	ctx := context.Background()
	requestPending := func(charge string, at time.Time) string {
		invoice := reload(t, f, saveNew(t, f, model.Amazon, base).ID())
		if err := invoice.MarkPaymentPending(charge, at); err != nil {
			t.Fatal(err)
		}
		if err := f.invoices.Save(ctx, invoice); err != nil {
			t.Fatal(err)
		}
		return invoice.ID()
	}
	third := requestPending("ch_3", base.Add(3*time.Minute))
	first := requestPending("ch_1", base.Add(1*time.Minute))
	second := requestPending("ch_2", base.Add(2*time.Minute))
	requestPending("ch_recent", base.Add(10*time.Minute))
	saveNew(t, f, model.Amazon, base) // issued, not pending
	paid := reload(t, f, requestPending("ch_old_paid", base))
	if _, err := paid.ConfirmPayment("ch_old_paid", base.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if err := f.invoices.Save(ctx, paid); err != nil {
		t.Fatal(err)
	}
	cutoff := base.Add(5 * time.Minute)
	requestPending("ch_edge", cutoff) // pending for exactly the window, which is not "more than" it

	all, err := f.invoices.ListPendingRequestedBefore(ctx, cutoff, 10)
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{first, second, third}; !slices.Equal(idsOf(all), want) {
		t.Fatalf("pending before the cutoff = %v, want %v: oldest first, without the recent one, the one at the cutoff, the issued one and the paid one", idsOf(all), want)
	}
	if all[0].PSPTransactionID != "ch_1" {
		t.Errorf("first charge = %q, want ch_1", all[0].PSPTransactionID)
	}

	limited, err := f.invoices.ListPendingRequestedBefore(ctx, cutoff, 2)
	if err != nil || !slices.Equal(idsOf(limited), []string{first, second}) {
		t.Fatalf("with a limit of 2 = %v (err %v), want the two oldest", idsOf(limited), err)
	}

	none, err := f.invoices.ListPendingRequestedBefore(ctx, base, 10)
	if err != nil || len(none) != 0 {
		t.Fatalf("with an early cutoff = %v (err %v), want none", idsOf(none), err)
	}
}
