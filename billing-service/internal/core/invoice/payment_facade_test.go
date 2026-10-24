package invoice_test

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/model"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/port/in"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/port/out"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/shared/domain"
)

const chargeID = "ch_paid_invoice-1"

// fakePaymentRepository adds to the fake repository the three queries of the payment.
type fakePaymentRepository struct {
	*fakeRepository
	cutoff time.Time
	limit  int
	// pendingOverride, when set, is what the listing returns: a stale view of invoices that changed since.
	pendingOverride []model.Snapshot
}

func (r *fakePaymentRepository) LockNextDue(ctx context.Context, at time.Time) (*model.Invoice, error) {
	if err := requireTx(ctx); err != nil {
		return nil, err
	}
	var due []model.Snapshot
	for _, snapshot := range r.byID {
		if model.Restore(snapshot).IsPaymentDue(at) {
			due = append(due, snapshot)
		}
	}
	if len(due) == 0 {
		return nil, domain.NewNotFoundError("no invoice is due")
	}
	sort.Slice(due, func(i, j int) bool { return due[i].IssuedAt.Before(due[j].IssuedAt) })
	return model.Restore(due[0]), nil
}

func (r *fakePaymentRepository) LockByID(ctx context.Context, id string) (*model.Invoice, error) {
	if err := requireTx(ctx); err != nil {
		return nil, err
	}
	return r.FindByID(ctx, id)
}

func (r *fakePaymentRepository) ListPendingRequestedBefore(_ context.Context, cutoff time.Time, limit int) ([]model.Snapshot, error) {
	r.cutoff, r.limit = cutoff, limit
	if r.pendingOverride != nil {
		return r.pendingOverride, nil
	}
	var pending []model.Snapshot
	for _, snapshot := range r.byID {
		if snapshot.Status == model.StatusPaymentPending && snapshot.PaymentRequestedAt != nil && snapshot.PaymentRequestedAt.Before(cutoff) {
			pending = append(pending, snapshot)
		}
	}
	sort.Slice(pending, func(i, j int) bool { return pending[i].PaymentRequestedAt.Before(*pending[j].PaymentRequestedAt) })
	if len(pending) > limit {
		pending = pending[:limit]
	}
	return pending, nil
}

type fakeGateway struct {
	created   out.ChargeCreated
	createErr error
	requests  []out.ChargeRequest

	statuses map[string]out.ChargeStatus
	getErr   error
	queried  []string
}

func (g *fakeGateway) CreateCharge(_ context.Context, request out.ChargeRequest) (out.ChargeCreated, error) {
	g.requests = append(g.requests, request)
	return g.created, g.createErr
}

func (g *fakeGateway) GetCharge(_ context.Context, id string) (out.ChargeStatus, error) {
	g.queried = append(g.queried, id)
	if g.getErr != nil {
		return out.ChargeStatus{}, g.getErr
	}
	return g.statuses[id], nil
}

type paymentFixture struct {
	facade     *invoice.PaymentFacade
	repository *fakePaymentRepository
	gateway    *fakeGateway
	transactor *fakeTransactor
}

func newPaymentFixture(options invoice.PaymentOptions) paymentFixture {
	f := paymentFixture{
		repository: &fakePaymentRepository{fakeRepository: newFakeRepository()},
		gateway:    &fakeGateway{created: out.ChargeCreated{ID: chargeID}},
		transactor: &fakeTransactor{},
	}
	f.facade = invoice.NewPaymentFacade(f.repository, f.transactor, f.gateway, fixedClock{}, options)
	return f
}

func issuedInvoice(id string, issuedAt time.Time) model.Snapshot {
	return model.Snapshot{
		ID: id, OrderID: "order-" + id, Marketplace: model.MercadoLivre, Status: model.StatusIssued,
		Total: 1500000, Commission: 165000, Net: 1335000, CommissionRateBps: 1100, IssuedAt: issuedAt, UpdatedAt: issuedAt,
		Items: []model.Item{{SKU: "231", Quantity: 1, UnitPrice: 1500000}},
	}
}

func pendingInvoice(id string, requestedAt time.Time) model.Snapshot {
	snapshot := issuedInvoice(id, requestedAt.Add(-time.Minute))
	snapshot.Status = model.StatusPaymentPending
	snapshot.PSPTransactionID = "ch_" + id
	snapshot.PaymentRequestedAt = &requestedAt
	return snapshot
}

func lastSaved(t *testing.T, f paymentFixture) model.Snapshot {
	t.Helper()
	if len(f.repository.saved) == 0 {
		t.Fatal("nothing was saved")
	}
	return f.repository.saved[len(f.repository.saved)-1]
}

func eventNames(f paymentFixture) []string {
	var names []string
	for _, event := range f.repository.events {
		names = append(names, event.EventName())
	}
	return names
}

func TestRequestNextPaymentDoesNothingWhenNoInvoiceIsDue(t *testing.T) {
	f := newPaymentFixture(invoice.PaymentOptions{})

	outcome, err := f.facade.RequestNextPayment(context.Background())

	if err != nil || outcome != in.NoneDue {
		t.Fatalf("RequestNextPayment() = (%q, %v), want (NONE_DUE, nil)", outcome, err)
	}
	if len(f.gateway.requests) != 0 || len(f.repository.saved) != 0 {
		t.Fatalf("the PSP got %d requests and %d invoices were saved, want none", len(f.gateway.requests), len(f.repository.saved))
	}
}

// PAY-01 and PAY-02: the PSP is asked for the total of the invoice and its acceptance is stored.
func TestRequestNextPaymentChargesTheTotalAndMarksTheInvoicePending(t *testing.T) {
	f := newPaymentFixture(invoice.PaymentOptions{})
	f.repository.seed(issuedInvoice("invoice-1", now.Add(-time.Hour)))

	outcome, err := f.facade.RequestNextPayment(context.Background())

	if err != nil || outcome != in.Pending {
		t.Fatalf("RequestNextPayment() = (%q, %v), want (PENDING, nil)", outcome, err)
	}
	if len(f.gateway.requests) != 1 {
		t.Fatalf("the PSP got %d requests, want 1", len(f.gateway.requests))
	}
	request := f.gateway.requests[0]
	if request.InvoiceID != "invoice-1" || request.Amount != 1500000 || !strings.Contains(request.Description, "order-invoice-1") || !strings.Contains(request.Description, "MERCADO_LIVRE") {
		t.Fatalf("charge request = %+v, want the invoice id, 1500000 cents and a description with the order and the marketplace", request)
	}
	got := lastSaved(t, f)
	if got.Status != model.StatusPaymentPending || got.PSPTransactionID != chargeID || got.PaymentRequestedAt == nil || !got.PaymentRequestedAt.Equal(now) {
		t.Fatalf("saved invoice = status %q charge %q requestedAt %v, want PAYMENT_PENDING, %s and now", got.Status, got.PSPTransactionID, got.PaymentRequestedAt, chargeID)
	}
	if names := eventNames(f); len(names) != 0 {
		t.Fatalf("events = %v, want none: only the outcome is published", names)
	}
}

func TestRequestNextPaymentTakesTheOldestDueInvoiceFirst(t *testing.T) {
	f := newPaymentFixture(invoice.PaymentOptions{})
	f.repository.seed(issuedInvoice("newer", now.Add(-time.Minute)))
	f.repository.seed(issuedInvoice("older", now.Add(-time.Hour)))

	if _, err := f.facade.RequestNextPayment(context.Background()); err != nil {
		t.Fatal(err)
	}

	if got := f.gateway.requests[0].InvoiceID; got != "older" {
		t.Fatalf("charged %q first, want the older invoice", got)
	}
}

func TestRequestNextPaymentSkipsAnInvoiceWhoseNextAttemptHasNotCome(t *testing.T) {
	f := newPaymentFixture(invoice.PaymentOptions{})
	waiting := issuedInvoice("waiting", now.Add(-time.Hour))
	later := now.Add(time.Second)
	waiting.NextPaymentAttemptAt = &later
	f.repository.seed(waiting)

	outcome, err := f.facade.RequestNextPayment(context.Background())

	if err != nil || outcome != in.NoneDue || len(f.gateway.requests) != 0 {
		t.Fatalf("RequestNextPayment() = (%q, %v) with %d PSP requests, want (NONE_DUE, nil) and none", outcome, err, len(f.gateway.requests))
	}
}

// PAY-05: the PSP refuses to create the charge, so the invoice fails with the reason and no charge id.
func TestRequestNextPaymentFailsTheInvoiceWhenThePSPRefusesTheCharge(t *testing.T) {
	f := newPaymentFixture(invoice.PaymentOptions{})
	f.repository.seed(issuedInvoice("invoice-1", now.Add(-time.Hour)))
	f.gateway.createErr = &out.RefusedError{Code: "AMOUNT_NOT_ALLOWED"}

	outcome, err := f.facade.RequestNextPayment(context.Background())

	if err != nil || outcome != in.Refused {
		t.Fatalf("RequestNextPayment() = (%q, %v), want (REFUSED, nil)", outcome, err)
	}
	got := lastSaved(t, f)
	if got.Status != model.StatusPaymentFailed || got.FailureReason != "AMOUNT_NOT_ALLOWED" || got.PSPTransactionID != "" {
		t.Fatalf("saved invoice = status %q reason %q charge %q, want PAYMENT_FAILED, AMOUNT_NOT_ALLOWED and no charge", got.Status, got.FailureReason, got.PSPTransactionID)
	}
	if names := eventNames(f); !slices.Equal(names, []string{"PaymentFailed"}) {
		t.Fatalf("events = %v, want PaymentFailed", names)
	}
}

// PAY-10: an unreachable PSP leaves the invoice issued and schedules the next attempt.
func TestRequestNextPaymentPostponesTheInvoiceWhenThePSPIsUnavailable(t *testing.T) {
	f := newPaymentFixture(invoice.PaymentOptions{})
	f.repository.seed(issuedInvoice("invoice-1", now.Add(-time.Hour)))
	f.gateway.createErr = fmt.Errorf("charge: %w", out.ErrUnavailable)

	outcome, err := f.facade.RequestNextPayment(context.Background())

	if err != nil || outcome != in.Postponed {
		t.Fatalf("RequestNextPayment() = (%q, %v), want (POSTPONED, nil)", outcome, err)
	}
	got := lastSaved(t, f)
	if got.Status != model.StatusIssued || got.PaymentAttempts != 1 || got.NextPaymentAttemptAt == nil || !got.NextPaymentAttemptAt.Equal(now.Add(2*time.Second)) {
		t.Fatalf("saved invoice = status %q attempts %d next %v, want ISSUED, 1 attempt and the next one 2 s later", got.Status, got.PaymentAttempts, got.NextPaymentAttemptAt)
	}
	if names := eventNames(f); len(names) != 0 {
		t.Fatalf("events = %v, want none", names)
	}
}

func TestRequestNextPaymentPostponesAndReportsAnUnexpectedPSPError(t *testing.T) {
	f := newPaymentFixture(invoice.PaymentOptions{})
	f.repository.seed(issuedInvoice("invoice-1", now.Add(-time.Hour)))
	broken := errors.New("unexpected status 400")
	f.gateway.createErr = broken

	outcome, err := f.facade.RequestNextPayment(context.Background())

	if !errors.Is(err, broken) || outcome != in.Postponed {
		t.Fatalf("RequestNextPayment() = (%q, %v), want (POSTPONED, %v): the retry is scheduled and the cause is reported", outcome, err, broken)
	}
	if got := lastSaved(t, f); got.PaymentAttempts != 1 || got.Status != model.StatusIssued {
		t.Fatalf("saved invoice = status %q attempts %d, want ISSUED with 1 attempt, so the next tick does not hammer the PSP", got.Status, got.PaymentAttempts)
	}
}

func TestRequestNextPaymentRunsInOneTransaction(t *testing.T) {
	f := newPaymentFixture(invoice.PaymentOptions{})
	f.repository.seed(issuedInvoice("invoice-1", now.Add(-time.Hour)))

	if _, err := f.facade.RequestNextPayment(context.Background()); err != nil {
		t.Fatal(err)
	}

	if f.transactor.calls != 1 {
		t.Fatalf("transactions opened = %d, want 1: the lock, the PSP call and the save share it (the fakes fail outside one)", f.transactor.calls)
	}
}

// PAY-03: the webhook reports the payment.
func TestApplyPaymentResultPaysThePendingInvoice(t *testing.T) {
	f := newPaymentFixture(invoice.PaymentOptions{})
	f.repository.seed(pendingInvoice("invoice-1", now.Add(-time.Minute)))
	paidAt := now.Add(-5 * time.Second)

	changed, err := f.facade.ApplyPaymentResult(context.Background(), in.PaymentResult{
		InvoiceID: "invoice-1", ChargeID: "ch_invoice-1", Status: in.PaymentPaid, OccurredAt: paidAt,
	})

	if err != nil || !changed {
		t.Fatalf("ApplyPaymentResult() = (%v, %v), want (true, nil)", changed, err)
	}
	got := lastSaved(t, f)
	if got.Status != model.StatusPaid || got.PaidAt == nil || !got.PaidAt.Equal(paidAt) {
		t.Fatalf("saved invoice = status %q paidAt %v, want PAID at the time the PSP reported", got.Status, got.PaidAt)
	}
	if names := eventNames(f); !slices.Equal(names, []string{"PaymentConfirmed"}) {
		t.Fatalf("events = %v, want PaymentConfirmed", names)
	}
}

func TestApplyPaymentResultUsesTheClockWhenThePSPGivesNoTime(t *testing.T) {
	f := newPaymentFixture(invoice.PaymentOptions{})
	f.repository.seed(pendingInvoice("invoice-1", now.Add(-time.Minute)))

	if _, err := f.facade.ApplyPaymentResult(context.Background(), in.PaymentResult{InvoiceID: "invoice-1", ChargeID: "ch_invoice-1", Status: in.PaymentPaid}); err != nil {
		t.Fatal(err)
	}

	if got := lastSaved(t, f); got.PaidAt == nil || !got.PaidAt.Equal(now) {
		t.Fatalf("paidAt = %v, want now", got.PaidAt)
	}
}

// PAY-04: the webhook reports the refusal, with the reason, or with a default one when the PSP gives none.
func TestApplyPaymentResultFailsThePendingInvoiceWithTheReason(t *testing.T) {
	for name, tt := range map[string]struct{ reason, want string }{
		"with a reason":    {"INSUFFICIENT_FUNDS", "INSUFFICIENT_FUNDS"},
		"without a reason": {"  ", "UNSPECIFIED"},
	} {
		t.Run(name, func(t *testing.T) {
			f := newPaymentFixture(invoice.PaymentOptions{})
			f.repository.seed(pendingInvoice("invoice-1", now.Add(-time.Minute)))

			changed, err := f.facade.ApplyPaymentResult(context.Background(), in.PaymentResult{
				InvoiceID: "invoice-1", ChargeID: "ch_invoice-1", Status: in.PaymentFailed, FailureReason: tt.reason,
			})

			if err != nil || !changed {
				t.Fatalf("ApplyPaymentResult() = (%v, %v), want (true, nil)", changed, err)
			}
			if got := lastSaved(t, f); got.Status != model.StatusPaymentFailed || got.FailureReason != tt.want {
				t.Fatalf("saved invoice = status %q reason %q, want PAYMENT_FAILED and %q", got.Status, got.FailureReason, tt.want)
			}
			if names := eventNames(f); !slices.Equal(names, []string{"PaymentFailed"}) {
				t.Fatalf("events = %v, want PaymentFailed", names)
			}
		})
	}
}

// Edge case: the webhook can arrive while the invoice is still issued, because the worker had not saved the charge yet.
func TestApplyPaymentResultStoresTheChargeOfAnInvoiceThatIsStillIssued(t *testing.T) {
	f := newPaymentFixture(invoice.PaymentOptions{})
	f.repository.seed(issuedInvoice("invoice-1", now.Add(-time.Minute)))

	changed, err := f.facade.ApplyPaymentResult(context.Background(), in.PaymentResult{InvoiceID: "invoice-1", ChargeID: chargeID, Status: in.PaymentPaid})

	if err != nil || !changed {
		t.Fatalf("ApplyPaymentResult() = (%v, %v), want (true, nil)", changed, err)
	}
	if got := lastSaved(t, f); got.Status != model.StatusPaid || got.PSPTransactionID != chargeID {
		t.Fatalf("saved invoice = status %q charge %q, want PAID with the charge of the webhook", got.Status, got.PSPTransactionID)
	}
}

// PAY-07: the same outcome again changes nothing and publishes nothing.
func TestApplyPaymentResultRepeatedChangesNothing(t *testing.T) {
	f := newPaymentFixture(invoice.PaymentOptions{})
	f.repository.seed(pendingInvoice("invoice-1", now.Add(-time.Minute)))
	result := in.PaymentResult{InvoiceID: "invoice-1", ChargeID: "ch_invoice-1", Status: in.PaymentPaid}
	if _, err := f.facade.ApplyPaymentResult(context.Background(), result); err != nil {
		t.Fatal(err)
	}

	changed, err := f.facade.ApplyPaymentResult(context.Background(), result)

	if err != nil || changed {
		t.Fatalf("second ApplyPaymentResult() = (%v, %v), want (false, nil)", changed, err)
	}
	if len(f.repository.saved) != 1 || len(f.repository.events) != 1 {
		t.Fatalf("saved %d times and recorded %d events, want 1 and 1", len(f.repository.saved), len(f.repository.events))
	}
}

// PAY-08: a result that contradicts the invoice is a conflict and nothing is saved.
func TestApplyPaymentResultThatContradictsTheInvoiceIsAConflict(t *testing.T) {
	f := newPaymentFixture(invoice.PaymentOptions{})
	failed := pendingInvoice("invoice-1", now.Add(-time.Minute))
	failed.Status = model.StatusPaymentFailed
	f.repository.seed(failed)

	changed, err := f.facade.ApplyPaymentResult(context.Background(), in.PaymentResult{InvoiceID: "invoice-1", ChargeID: "ch_invoice-1", Status: in.PaymentPaid})

	var conflict *domain.ConflictError
	if !errors.As(err, &conflict) || changed {
		t.Fatalf("ApplyPaymentResult() = (%v, %v), want (false, a ConflictError)", changed, err)
	}
	if len(f.repository.saved) != 0 {
		t.Fatalf("saved %d invoices, want none", len(f.repository.saved))
	}
}

func TestApplyPaymentResultForAnUnknownInvoiceIsNotFound(t *testing.T) {
	f := newPaymentFixture(invoice.PaymentOptions{})

	_, err := f.facade.ApplyPaymentResult(context.Background(), in.PaymentResult{InvoiceID: "missing", ChargeID: chargeID, Status: in.PaymentPaid})

	var notFound *domain.NotFoundError
	if !errors.As(err, &notFound) {
		t.Fatalf("error = %v, want a NotFoundError", err)
	}
}

// REC-01 and REC-02: the charges pending for more than 60 s are queried, and a final status is applied like the webhook.
func TestReconcilePendingPaymentsAppliesTheFinalStatusesOfTheOldCharges(t *testing.T) {
	f := newPaymentFixture(invoice.PaymentOptions{})
	f.repository.seed(pendingInvoice("paid", now.Add(-5*time.Minute)))
	f.repository.seed(pendingInvoice("refused", now.Add(-4*time.Minute)))
	f.repository.seed(pendingInvoice("still-pending", now.Add(-3*time.Minute)))
	f.repository.seed(pendingInvoice("too-recent", now.Add(-10*time.Second)))
	f.gateway.statuses = map[string]out.ChargeStatus{
		"ch_paid":          {State: out.ChargePaid},
		"ch_refused":       {State: out.ChargeFailed, FailureReason: "INSUFFICIENT_FUNDS"},
		"ch_still-pending": {State: out.ChargePending},
	}

	resolved, err := f.facade.ReconcilePendingPayments(context.Background())

	if err != nil || resolved != 2 {
		t.Fatalf("ReconcilePendingPayments() = (%d, %v), want (2, nil)", resolved, err)
	}
	if want := now.Add(-60 * time.Second); !f.repository.cutoff.Equal(want) || f.repository.limit != 50 {
		t.Fatalf("pending charges were listed with cutoff %v and limit %d, want %v and 50", f.repository.cutoff, f.repository.limit, want)
	}
	if !slices.Equal(f.gateway.queried, []string{"ch_paid", "ch_refused", "ch_still-pending"}) {
		t.Fatalf("the PSP was asked about %v, want the three old charges, oldest first, and not the recent one", f.gateway.queried)
	}
	if got := f.repository.byID["paid"]; got.Status != model.StatusPaid {
		t.Errorf("paid invoice status = %q, want PAID", got.Status)
	}
	if got := f.repository.byID["refused"]; got.Status != model.StatusPaymentFailed || got.FailureReason != "INSUFFICIENT_FUNDS" {
		t.Errorf("refused invoice = %q %q, want PAYMENT_FAILED and INSUFFICIENT_FUNDS", got.Status, got.FailureReason)
	}
	if got := f.repository.byID["still-pending"]; got.Status != model.StatusPaymentPending {
		t.Errorf("pending invoice status = %q, want it untouched", got.Status)
	}
	if names := eventNames(f); !slices.Equal(names, []string{"PaymentConfirmed", "PaymentFailed"}) {
		t.Fatalf("events = %v, want the two outcomes", names)
	}
}

func TestReconcilePendingPaymentsStopsWhenThePSPIsUnavailable(t *testing.T) {
	f := newPaymentFixture(invoice.PaymentOptions{})
	f.repository.seed(pendingInvoice("first", now.Add(-5*time.Minute)))
	f.repository.seed(pendingInvoice("second", now.Add(-4*time.Minute)))
	f.gateway.getErr = fmt.Errorf("get charge: %w", out.ErrUnavailable)

	resolved, err := f.facade.ReconcilePendingPayments(context.Background())

	if !errors.Is(err, out.ErrUnavailable) || resolved != 0 {
		t.Fatalf("ReconcilePendingPayments() = (%d, %v), want (0, an error wrapping ErrUnavailable)", resolved, err)
	}
	if len(f.gateway.queried) != 1 {
		t.Fatalf("the PSP was asked %d times, want 1: no point in asking again while it is down", len(f.gateway.queried))
	}
}

func TestReconcilePendingPaymentsGoesOnAfterAConflictAndReportsIt(t *testing.T) {
	f := newPaymentFixture(invoice.PaymentOptions{})
	conflicting := pendingInvoice("conflicting", now.Add(-5*time.Minute))
	conflicting.PSPTransactionID = "ch_another"
	f.repository.seed(conflicting)
	f.repository.seed(pendingInvoice("ok", now.Add(-4*time.Minute)))
	f.gateway.statuses = map[string]out.ChargeStatus{"ch_another": {State: out.ChargePaid}, "ch_ok": {State: out.ChargePaid}}
	// The PSP answers for ch_another, but the invoice then fails on a charge it does not have.
	f.repository.byID["conflicting"] = func() model.Snapshot {
		s := conflicting
		s.Status = model.StatusPaymentFailed
		return s
	}()
	f.repository.pendingOverride = []model.Snapshot{conflicting, pendingInvoice("ok", now.Add(-4*time.Minute))}

	resolved, err := f.facade.ReconcilePendingPayments(context.Background())

	var conflict *domain.ConflictError
	if !errors.As(err, &conflict) || resolved != 1 {
		t.Fatalf("ReconcilePendingPayments() = (%d, %v), want (1, a ConflictError for the first invoice)", resolved, err)
	}
	if got := f.repository.byID["ok"]; got.Status != model.StatusPaid {
		t.Fatalf("the invoice after the conflict has status %q, want PAID", got.Status)
	}
}

func TestReconcilePendingPaymentsHonoursItsOptions(t *testing.T) {
	f := newPaymentFixture(invoice.PaymentOptions{ReconcileAfter: 5 * time.Minute, ReconcileBatch: 2})
	for i, age := range []time.Duration{10 * time.Minute, 9 * time.Minute, 8 * time.Minute, 2 * time.Minute} {
		f.repository.seed(pendingInvoice(fmt.Sprintf("invoice-%d", i), now.Add(-age)))
	}

	if _, err := f.facade.ReconcilePendingPayments(context.Background()); err != nil {
		t.Fatal(err)
	}

	if want := now.Add(-5 * time.Minute); !f.repository.cutoff.Equal(want) || f.repository.limit != 2 {
		t.Fatalf("cutoff %v and limit %d, want %v and 2", f.repository.cutoff, f.repository.limit, want)
	}
	if len(f.gateway.queried) != 2 {
		t.Fatalf("the PSP was asked %d times, want 2 (the batch)", len(f.gateway.queried))
	}
}

var (
	_ in.RequestPaymentUseCase     = (*invoice.PaymentFacade)(nil)
	_ in.ApplyPaymentResultUseCase = (*invoice.PaymentFacade)(nil)
	_ in.ReconcilePaymentsUseCase  = (*invoice.PaymentFacade)(nil)
)
