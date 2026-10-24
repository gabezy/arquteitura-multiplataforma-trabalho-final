package model_test

import (
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/model"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/shared/domain"
)

const chargeID = "ch_paid_" + invoiceID

func freshInvoice(t *testing.T) *model.Invoice {
	t.Helper()
	invoice := issue(t, orderOf(model.MercadoLivre, 1500000, itemOf(t, "231", 1, 1500000)), 1100)
	invoice.PullEvents() // the issued event was published when it was created
	return invoice
}

func invoiceIn(t *testing.T, status model.Status, mutate func(*model.Snapshot)) *model.Invoice {
	t.Helper()
	snapshot := freshInvoice(t).Snapshot()
	snapshot.Status = status
	if mutate != nil {
		mutate(&snapshot)
	}
	return model.Restore(snapshot)
}

func requireConflict(t *testing.T, err error) {
	t.Helper()
	var conflict *domain.ConflictError
	if !errors.As(err, &conflict) {
		t.Fatalf("error = %v, want a ConflictError", err)
	}
}

// PAY-02: the PSP accepted the charge.
func TestMarkPaymentPendingStoresTheChargeOfAnIssuedInvoice(t *testing.T) {
	invoice := freshInvoice(t)
	at := issuedAt.Add(3 * time.Second)

	if err := invoice.MarkPaymentPending(chargeID, at); err != nil {
		t.Fatalf("MarkPaymentPending() error = %v", err)
	}

	got := invoice.Snapshot()
	if got.Status != model.StatusPaymentPending || got.PSPTransactionID != chargeID {
		t.Fatalf("status/charge = %q/%q, want PAYMENT_PENDING and %q", got.Status, got.PSPTransactionID, chargeID)
	}
	if got.PaymentRequestedAt == nil || !got.PaymentRequestedAt.Equal(at) || got.NextPaymentAttemptAt != nil || !got.UpdatedAt.Equal(at) {
		t.Fatalf("requestedAt/nextAttempt/updatedAt = %v/%v/%v, want %v, none and %v", got.PaymentRequestedAt, got.NextPaymentAttemptAt, got.UpdatedAt, at, at)
	}
	if events := invoice.PullEvents(); len(events) != 0 {
		t.Fatalf("recorded %d events, want none: only the outcome is published", len(events))
	}
}

func TestMarkPaymentPendingIsIdempotentForTheSameChargeAndRejectsEverythingElse(t *testing.T) {
	pending := invoiceIn(t, model.StatusPaymentPending, func(s *model.Snapshot) { s.PSPTransactionID = chargeID })
	if err := pending.MarkPaymentPending(chargeID, issuedAt); err != nil {
		t.Fatalf("same charge again: error = %v, want nil", err)
	}
	requireConflict(t, pending.MarkPaymentPending("ch_paid_other", issuedAt))

	for _, status := range []model.Status{model.StatusPaid, model.StatusPaymentFailed, model.StatusCancelled} {
		requireConflict(t, invoiceIn(t, status, nil).MarkPaymentPending(chargeID, issuedAt))
	}

	var validation *domain.ValidationError
	if err := freshInvoice(t).MarkPaymentPending("  ", issuedAt); !errors.As(err, &validation) {
		t.Fatalf("blank charge id: error = %v, want a ValidationError", err)
	}
}

// PAY-10: the invoice stays ISSUED and the next attempt waits min(2^attempts, 60) seconds.
func TestPaymentAttemptFailedSchedulesTheNextAttemptWithBackoffCappedAtSixtySeconds(t *testing.T) {
	invoice := freshInvoice(t)
	now := issuedAt
	want := []time.Duration{2 * time.Second, 4 * time.Second, 8 * time.Second, 16 * time.Second, 32 * time.Second, 60 * time.Second, 60 * time.Second}

	for attempt, delay := range want {
		invoice.PaymentAttemptFailed(now)

		got := invoice.Snapshot()
		if got.Status != model.StatusIssued || got.PaymentAttempts != attempt+1 {
			t.Fatalf("attempt %d: status %q attempts %d, want ISSUED and %d", attempt+1, got.Status, got.PaymentAttempts, attempt+1)
		}
		if got.NextPaymentAttemptAt == nil || !got.NextPaymentAttemptAt.Equal(now.Add(delay)) {
			t.Fatalf("attempt %d: next attempt = %v, want %v after the failure", attempt+1, got.NextPaymentAttemptAt, delay)
		}
		now = now.Add(delay)
	}
}

func TestPaymentAttemptFailedDoesNothingToAnInvoiceThatIsNotIssued(t *testing.T) {
	for _, status := range []model.Status{model.StatusPaymentPending, model.StatusPaid, model.StatusPaymentFailed, model.StatusCancelled} {
		invoice := invoiceIn(t, status, nil)
		before := invoice.Snapshot()

		invoice.PaymentAttemptFailed(issuedAt.Add(time.Minute))

		if !reflect.DeepEqual(invoice.Snapshot(), before) {
			t.Errorf("%s: the snapshot changed", status)
		}
	}
}

// PAY-01: only an issued invoice whose next attempt is due.
func TestIsPaymentDueOnlyForAnIssuedInvoiceWhoseNextAttemptHasCome(t *testing.T) {
	now := issuedAt.Add(time.Hour)
	later, earlier := now.Add(time.Second), now.Add(-time.Second)

	tests := []struct {
		name    string
		invoice *model.Invoice
		want    bool
	}{
		{"never tried", invoiceIn(t, model.StatusIssued, nil), true},
		{"next attempt in the past", invoiceIn(t, model.StatusIssued, func(s *model.Snapshot) { s.NextPaymentAttemptAt = &earlier }), true},
		{"next attempt right now", invoiceIn(t, model.StatusIssued, func(s *model.Snapshot) { s.NextPaymentAttemptAt = &now }), true},
		{"next attempt in the future", invoiceIn(t, model.StatusIssued, func(s *model.Snapshot) { s.NextPaymentAttemptAt = &later }), false},
		{"waiting for the PSP", invoiceIn(t, model.StatusPaymentPending, nil), false},
		{"paid", invoiceIn(t, model.StatusPaid, nil), false},
		{"cancelled", invoiceIn(t, model.StatusCancelled, nil), false},
	}
	for _, tt := range tests {
		if got := tt.invoice.IsPaymentDue(now); got != tt.want {
			t.Errorf("%s: IsPaymentDue() = %v, want %v", tt.name, got, tt.want)
		}
	}
}

// PAY-03: the PSP reports the payment.
func TestConfirmPaymentPaysAnInvoiceThatIsIssuedOrPending(t *testing.T) {
	paidAt := issuedAt.Add(4 * time.Second)
	for _, status := range []model.Status{model.StatusIssued, model.StatusPaymentPending} {
		t.Run(string(status), func(t *testing.T) {
			invoice := invoiceIn(t, status, nil)

			changed, err := invoice.ConfirmPayment(chargeID, paidAt)

			if err != nil || !changed {
				t.Fatalf("ConfirmPayment() = (%v, %v), want (true, nil)", changed, err)
			}
			got := invoice.Snapshot()
			if got.Status != model.StatusPaid || got.PSPTransactionID != chargeID || got.PaidAt == nil || !got.PaidAt.Equal(paidAt) || !got.UpdatedAt.Equal(paidAt) {
				t.Fatalf("snapshot = status %q charge %q paidAt %v updatedAt %v", got.Status, got.PSPTransactionID, got.PaidAt, got.UpdatedAt)
			}
			events := invoice.PullEvents()
			want := model.PaymentConfirmed{InvoiceID: invoiceID, OrderID: orderID, Amount: 1500000, PSPTransactionID: chargeID, PaidAt: paidAt}
			if len(events) != 1 || events[0] != want {
				t.Fatalf("events = %#v, want one %#v", events, want)
			}
			if want.EventName() != "PaymentConfirmed" || want.AggregateID() != invoiceID || !want.OccurredAt().Equal(paidAt) {
				t.Errorf("event name/aggregate/time = %q/%q/%v", want.EventName(), want.AggregateID(), want.OccurredAt())
			}
		})
	}
}

// PAY-07: the same outcome again changes nothing and publishes nothing.
func TestConfirmPaymentRepeatedForTheSameChargeChangesNothing(t *testing.T) {
	invoice := invoiceIn(t, model.StatusPaymentPending, nil)
	if _, err := invoice.ConfirmPayment(chargeID, issuedAt); err != nil {
		t.Fatal(err)
	}
	invoice.PullEvents()
	before := invoice.Snapshot()

	changed, err := invoice.ConfirmPayment(chargeID, issuedAt.Add(time.Hour))

	if err != nil || changed {
		t.Fatalf("ConfirmPayment() again = (%v, %v), want (false, nil)", changed, err)
	}
	if !reflect.DeepEqual(invoice.Snapshot(), before) || len(invoice.PullEvents()) != 0 {
		t.Fatal("a repeated confirmation changed the invoice or recorded an event")
	}
}

// PAY-08: what contradicts the state of the invoice is a conflict, and nothing changes.
func TestConfirmPaymentThatContradictsTheInvoiceIsAConflict(t *testing.T) {
	tests := []struct {
		name    string
		invoice *model.Invoice
		charge  string
	}{
		{"charge of another transaction", invoiceIn(t, model.StatusPaymentPending, func(s *model.Snapshot) { s.PSPTransactionID = "ch_paid_one" }), "ch_paid_two"},
		{"already paid with another charge", invoiceIn(t, model.StatusPaid, func(s *model.Snapshot) { s.PSPTransactionID = "ch_paid_one" }), "ch_paid_two"},
		{"payment failed", invoiceIn(t, model.StatusPaymentFailed, func(s *model.Snapshot) { s.PSPTransactionID = "ch_failed_x" }), "ch_failed_x"},
		{"cancelled", invoiceIn(t, model.StatusCancelled, nil), chargeID},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			before := tt.invoice.Snapshot()

			changed, err := tt.invoice.ConfirmPayment(tt.charge, issuedAt)

			requireConflict(t, err)
			if changed || !reflect.DeepEqual(tt.invoice.Snapshot(), before) || len(tt.invoice.PullEvents()) != 0 {
				t.Fatal("a conflicting confirmation changed the invoice or recorded an event")
			}
		})
	}

	var validation *domain.ValidationError
	if _, err := freshInvoice(t).ConfirmPayment("", issuedAt); !errors.As(err, &validation) {
		t.Fatalf("blank charge id: error = %v, want a ValidationError", err)
	}
}

// PAY-04 and PAY-05: a refusal, with the charge when the PSP created one and without it when it refused to.
func TestFailPaymentRefusesAnInvoiceThatIsIssuedOrPending(t *testing.T) {
	failedAt := issuedAt.Add(5 * time.Second)
	tests := []struct {
		name       string
		status     model.Status
		charge     string
		wantCharge string
	}{
		{"webhook for a pending invoice", model.StatusPaymentPending, "ch_failed_x", "ch_failed_x"},
		{"webhook that arrives while the invoice is still issued", model.StatusIssued, "ch_failed_x", "ch_failed_x"},
		{"refused on creation, with no charge", model.StatusIssued, "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			invoice := invoiceIn(t, tt.status, nil)

			changed, err := invoice.FailPayment(tt.charge, "INSUFFICIENT_FUNDS", failedAt)

			if err != nil || !changed {
				t.Fatalf("FailPayment() = (%v, %v), want (true, nil)", changed, err)
			}
			got := invoice.Snapshot()
			if got.Status != model.StatusPaymentFailed || got.FailureReason != "INSUFFICIENT_FUNDS" || got.PSPTransactionID != tt.wantCharge ||
				got.FailedAt == nil || !got.FailedAt.Equal(failedAt) || !got.UpdatedAt.Equal(failedAt) {
				t.Fatalf("snapshot = status %q reason %q charge %q failedAt %v", got.Status, got.FailureReason, got.PSPTransactionID, got.FailedAt)
			}
			events := invoice.PullEvents()
			want := model.PaymentFailed{InvoiceID: invoiceID, OrderID: orderID, Amount: 1500000, PSPTransactionID: tt.wantCharge, Reason: "INSUFFICIENT_FUNDS", FailedAt: failedAt}
			if len(events) != 1 || events[0] != want {
				t.Fatalf("events = %#v, want one %#v", events, want)
			}
			if want.EventName() != "PaymentFailed" || want.AggregateID() != invoiceID || !want.OccurredAt().Equal(failedAt) {
				t.Errorf("event name/aggregate/time = %q/%q/%v", want.EventName(), want.AggregateID(), want.OccurredAt())
			}
		})
	}
}

func TestFailPaymentRepeatedChangesNothingAndContradictionsAreConflicts(t *testing.T) {
	failed := invoiceIn(t, model.StatusPaymentFailed, func(s *model.Snapshot) { s.PSPTransactionID = "ch_failed_x"; s.FailureReason = "INSUFFICIENT_FUNDS" })
	before := failed.Snapshot()
	for _, charge := range []string{"ch_failed_x", ""} {
		changed, err := failed.FailPayment(charge, "OTHER_REASON", issuedAt.Add(time.Hour))
		if err != nil || changed || !reflect.DeepEqual(failed.Snapshot(), before) || len(failed.PullEvents()) != 0 {
			t.Fatalf("repeated refusal with charge %q: (%v, %v), want (false, nil) and nothing changed or published", charge, changed, err)
		}
	}

	conflicts := map[string]*model.Invoice{
		"another charge":  invoiceIn(t, model.StatusPaymentFailed, func(s *model.Snapshot) { s.PSPTransactionID = "ch_failed_one" }),
		"already paid":    invoiceIn(t, model.StatusPaid, func(s *model.Snapshot) { s.PSPTransactionID = "ch_failed_x" }),
		"cancelled":       invoiceIn(t, model.StatusCancelled, nil),
		"pending another": invoiceIn(t, model.StatusPaymentPending, func(s *model.Snapshot) { s.PSPTransactionID = "ch_paid_one" }),
	}
	for name, invoice := range conflicts {
		changed, err := invoice.FailPayment("ch_failed_x", "INSUFFICIENT_FUNDS", issuedAt)
		if changed {
			t.Errorf("%s: changed = true", name)
		}
		requireConflict(t, err)
	}

	var validation *domain.ValidationError
	if _, err := freshInvoice(t).FailPayment("ch_failed_x", " ", issuedAt); !errors.As(err, &validation) {
		t.Fatalf("blank reason: error = %v, want a ValidationError", err)
	}
}

func TestPaymentFieldsSurviveSnapshotAndRestore(t *testing.T) {
	requestedAt, paidAt, next := issuedAt.Add(time.Second), issuedAt.Add(2*time.Second), issuedAt.Add(3*time.Second)
	snapshot := freshInvoice(t).Snapshot()
	snapshot.Status = model.StatusPaid
	snapshot.PSPTransactionID = chargeID
	snapshot.FailureReason = "none"
	snapshot.PaymentAttempts = 3
	snapshot.NextPaymentAttemptAt, snapshot.PaymentRequestedAt, snapshot.PaidAt = &next, &requestedAt, &paidAt

	original := paidAt // by value: the snapshot points at paidAt itself

	got := model.Restore(snapshot).Snapshot()

	if !reflect.DeepEqual(got, snapshot) {
		t.Fatalf("round trip changed the snapshot:\n got  %+v\n want %+v", got, snapshot)
	}
	*got.PaidAt = got.PaidAt.Add(time.Hour)
	if !snapshot.PaidAt.Equal(original) {
		t.Fatal("changing the pointer of a restored snapshot changed the original: the times must be copied")
	}
}
