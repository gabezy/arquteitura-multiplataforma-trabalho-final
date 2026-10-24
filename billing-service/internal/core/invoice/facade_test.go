package invoice_test

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/model"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/port/in"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/shared/domain"
)

const orderID = "6f1c2b8e-0000-4000-8000-000000000001"

var now = time.Date(2026, 10, 28, 13, 5, 3, 0, time.UTC)

// fakeTransactor marks the context, so the fakes can tell that they run inside a transaction.
type txKey struct{}

type fakeTransactor struct{ calls int }

func (t *fakeTransactor) WithinTransaction(ctx context.Context, fn func(ctx context.Context) error) error {
	if ctx.Value(txKey{}) != nil {
		return fn(ctx)
	}
	t.calls++
	return fn(context.WithValue(ctx, txKey{}, true))
}

func requireTx(ctx context.Context) error {
	if ctx.Value(txKey{}) == nil {
		return errors.New("repository called outside a transaction")
	}
	return nil
}

type fakeRepository struct {
	byID      map[string]model.Snapshot
	byOrder   map[string]string
	saved     []model.Snapshot
	events    []domain.DomainEvent
	saveError error
	listed    model.InvoiceQuery
	listing   []model.Snapshot
}

func newFakeRepository() *fakeRepository {
	return &fakeRepository{byID: map[string]model.Snapshot{}, byOrder: map[string]string{}}
}

func (r *fakeRepository) Save(ctx context.Context, inv *model.Invoice) error {
	if err := requireTx(ctx); err != nil {
		return err
	}
	if r.saveError != nil {
		return r.saveError
	}
	snapshot := inv.Snapshot()
	r.events = append(r.events, inv.PullEvents()...)
	r.byID[snapshot.ID] = snapshot
	r.byOrder[snapshot.OrderID] = snapshot.ID
	r.saved = append(r.saved, snapshot)
	return nil
}

func (r *fakeRepository) FindByID(_ context.Context, id string) (*model.Invoice, error) {
	snapshot, ok := r.byID[id]
	if !ok {
		return nil, domain.NewNotFoundError("invoice %s not found", id)
	}
	return model.Restore(snapshot), nil
}

func (r *fakeRepository) FindByOrderID(ctx context.Context, orderID string) (*model.Invoice, error) {
	if err := requireTx(ctx); err != nil {
		return nil, err
	}
	id, ok := r.byOrder[orderID]
	if !ok {
		return nil, domain.NewNotFoundError("order %s has no invoice", orderID)
	}
	return model.Restore(r.byID[id]), nil
}

func (r *fakeRepository) List(ctx context.Context, query model.InvoiceQuery) ([]model.Snapshot, error) {
	r.listed = query
	return r.listing, nil
}

func (r *fakeRepository) seed(snapshot model.Snapshot) {
	r.byID[snapshot.ID] = snapshot
	r.byOrder[snapshot.OrderID] = snapshot.ID
}

type fakeCancellations struct {
	recorded map[string]string
}

func (c *fakeCancellations) Record(ctx context.Context, orderID, reason string, _ time.Time) error {
	if err := requireTx(ctx); err != nil {
		return err
	}
	if _, ok := c.recorded[orderID]; !ok {
		c.recorded[orderID] = reason
	}
	return nil
}

func (c *fakeCancellations) IsCancelled(ctx context.Context, orderID string) (bool, error) {
	if err := requireTx(ctx); err != nil {
		return false, err
	}
	_, ok := c.recorded[orderID]
	return ok, nil
}

type sequentialIDs struct{ n int }

func (s *sequentialIDs) NewID() string {
	s.n++
	return "invoice-" + string(rune('0'+s.n))
}

type fixedClock struct{}

func (fixedClock) Now() time.Time { return now }

type fixture struct {
	facade        *invoice.Facade
	repository    *fakeRepository
	cancellations *fakeCancellations
	transactor    *fakeTransactor
}

func newFixture(t *testing.T) fixture {
	t.Helper()
	amazon, _ := model.NewPercentageCommission(1200)
	mercadoLivre, _ := model.NewPercentageCommission(1100)
	f := fixture{
		repository:    newFakeRepository(),
		cancellations: &fakeCancellations{recorded: map[string]string{}},
		transactor:    &fakeTransactor{},
	}
	f.facade = invoice.NewFacade(
		f.repository,
		f.cancellations,
		f.transactor,
		&sequentialIDs{},
		fixedClock{},
		model.CommissionPolicies{model.Amazon: amazon, model.MercadoLivre: mercadoLivre},
	)
	return f
}

func iphoneOrder(t *testing.T, marketplace model.Marketplace) model.OrderData {
	t.Helper()
	item, err := model.NewItem("231", 1, 1500000)
	if err != nil {
		t.Fatal(err)
	}
	return model.OrderData{OrderID: orderID, ExternalOrderID: "ML-2000001", Marketplace: marketplace, Items: []model.Item{item}, DeclaredTotal: 1500000}
}

// INV-01, INV-02, INV-03: a confirmed order becomes one invoice, saved with its event.
func TestIssueInvoiceCreatesAndSavesTheInvoiceOfTheMarketplaceRate(t *testing.T) {
	f := newFixture(t)

	outcome, err := f.facade.IssueInvoice(context.Background(), iphoneOrder(t, model.MercadoLivre))

	if err != nil || outcome != in.Issued {
		t.Fatalf("IssueInvoice() = (%q, %v), want (ISSUED, nil)", outcome, err)
	}
	if len(f.repository.saved) != 1 {
		t.Fatalf("saved %d invoices, want 1", len(f.repository.saved))
	}
	got := f.repository.saved[0]
	if got.ID != "invoice-1" || got.OrderID != orderID || got.Status != model.StatusIssued || !got.IssuedAt.Equal(now) {
		t.Errorf("saved invoice = %+v", got)
	}
	if got.Total != 1500000 || got.Commission != 165000 || got.Net != 1335000 || got.CommissionRateBps != 1100 {
		t.Errorf("total/commission/net/rate = %d/%d/%d/%d, want 1500000/165000/1335000/1100 (Mercado Livre, 11%%)",
			got.Total, got.Commission, got.Net, got.CommissionRateBps)
	}
	if len(f.repository.events) != 1 || f.repository.events[0].EventName() != "InvoiceIssued" {
		t.Errorf("events handed to the repository = %v, want one InvoiceIssued", f.repository.events)
	}
}

func TestIssueInvoiceUsesTheCommissionOfEachMarketplace(t *testing.T) {
	f := newFixture(t)

	if _, err := f.facade.IssueInvoice(context.Background(), iphoneOrder(t, model.Amazon)); err != nil {
		t.Fatal(err)
	}

	if got := f.repository.saved[0]; got.Commission != 180000 || got.CommissionRateBps != 1200 {
		t.Fatalf("commission/rate = %d/%d, want 180000/1200 (Amazon, 12%%)", got.Commission, got.CommissionRateBps)
	}
}

// INV-05: a confirmation for an order that already has an invoice keeps the single one.
func TestIssueInvoiceKeepsTheInvoiceOfAnOrderThatAlreadyHasOne(t *testing.T) {
	f := newFixture(t)
	order := iphoneOrder(t, model.MercadoLivre)
	if _, err := f.facade.IssueInvoice(context.Background(), order); err != nil {
		t.Fatal(err)
	}

	outcome, err := f.facade.IssueInvoice(context.Background(), order)

	if err != nil || outcome != in.AlreadyIssued {
		t.Fatalf("second IssueInvoice() = (%q, %v), want (ALREADY_ISSUED, nil)", outcome, err)
	}
	if len(f.repository.saved) != 1 || len(f.repository.events) != 1 {
		t.Fatalf("saved %d invoices and %d events, want 1 and 1: nothing is published again", len(f.repository.saved), len(f.repository.events))
	}
}

// INV-10: the cancellation arrived first, so the confirmation creates nothing.
func TestIssueInvoiceCreatesNothingForAnOrderCancelledBeforeItsConfirmation(t *testing.T) {
	f := newFixture(t)
	f.cancellations.recorded[orderID] = "OUT_OF_STOCK"

	outcome, err := f.facade.IssueInvoice(context.Background(), iphoneOrder(t, model.MercadoLivre))

	if err != nil || outcome != in.OrderCancelled {
		t.Fatalf("IssueInvoice() = (%q, %v), want (ORDER_CANCELLED, nil)", outcome, err)
	}
	if len(f.repository.saved) != 0 {
		t.Fatalf("saved %d invoices, want none", len(f.repository.saved))
	}
}

// INV-06: what the core rejects reaches the caller as a ValidationError, and nothing is saved.
func TestIssueInvoiceRejectsInvalidOrdersAndSavesNothing(t *testing.T) {
	f := newFixture(t)
	mismatch := iphoneOrder(t, model.MercadoLivre)
	mismatch.DeclaredTotal = 1

	for name, order := range map[string]model.OrderData{
		"total different from the items": mismatch,
		"marketplace without a policy":   iphoneOrder(t, model.Shopee),
		"unknown marketplace":            iphoneOrder(t, "EBAY"),
	} {
		_, err := f.facade.IssueInvoice(context.Background(), order)

		var validation *domain.ValidationError
		if !errors.As(err, &validation) {
			t.Errorf("%s: error = %v, want a ValidationError", name, err)
		}
	}
	if len(f.repository.saved) != 0 {
		t.Fatalf("saved %d invoices, want none", len(f.repository.saved))
	}
}

// Edge case: two confirmations at once. The loser gets a ConflictError to retry, not a validation error.
func TestIssueInvoiceReturnsTheConflictOfTheUniqueOrderKey(t *testing.T) {
	f := newFixture(t)
	f.repository.saveError = domain.NewConflictError("order %s already has an invoice", orderID)

	_, err := f.facade.IssueInvoice(context.Background(), iphoneOrder(t, model.MercadoLivre))

	var conflict *domain.ConflictError
	if !errors.As(err, &conflict) {
		t.Fatalf("error = %v, want a ConflictError", err)
	}
}

func TestIssueInvoiceReturnsInfrastructureErrorsUnchanged(t *testing.T) {
	f := newFixture(t)
	down := errors.New("connection refused")
	f.repository.saveError = down

	_, err := f.facade.IssueInvoice(context.Background(), iphoneOrder(t, model.MercadoLivre))

	if !errors.Is(err, down) {
		t.Fatalf("error = %v, want %v", err, down)
	}
}

// INV-08: an invoice still waiting for payment is cancelled and saved.
func TestCancelInvoiceCancelsAnIssuedInvoice(t *testing.T) {
	f := newFixture(t)
	if _, err := f.facade.IssueInvoice(context.Background(), iphoneOrder(t, model.MercadoLivre)); err != nil {
		t.Fatal(err)
	}

	outcome, err := f.facade.CancelInvoice(context.Background(), in.CancelInvoiceCommand{OrderID: orderID, Reason: "OUT_OF_STOCK"})

	if err != nil || outcome != in.Cancelled {
		t.Fatalf("CancelInvoice() = (%q, %v), want (CANCELLED, nil)", outcome, err)
	}
	last := f.repository.saved[len(f.repository.saved)-1]
	if last.Status != model.StatusCancelled || last.CancellationReason != "OUT_OF_STOCK" || last.CancelledAt == nil || !last.CancelledAt.Equal(now) {
		t.Fatalf("saved invoice after the cancellation = %+v", last)
	}
	if len(f.repository.events) != 1 {
		t.Errorf("events = %d, want 1: a cancellation publishes nothing", len(f.repository.events))
	}
}

// INV-11: a paid invoice keeps its state, and nothing is saved.
func TestCancelInvoiceKeepsAPaidInvoice(t *testing.T) {
	f := newFixture(t)
	f.repository.seed(model.Snapshot{ID: "invoice-9", OrderID: orderID, Marketplace: model.MercadoLivre, Status: model.StatusPaid, IssuedAt: now, UpdatedAt: now})

	outcome, err := f.facade.CancelInvoice(context.Background(), in.CancelInvoiceCommand{OrderID: orderID, Reason: "PAYMENT_FAILED"})

	if err != nil || outcome != in.Unchanged {
		t.Fatalf("CancelInvoice() = (%q, %v), want (UNCHANGED, nil)", outcome, err)
	}
	if len(f.repository.saved) != 0 {
		t.Fatalf("saved %d invoices, want none", len(f.repository.saved))
	}
}

// INV-09 and INV-10: with no invoice the cancellation is recorded, and a later confirmation creates none.
func TestCancelInvoiceRecordsTheCancellationOfAnOrderWithoutInvoice(t *testing.T) {
	f := newFixture(t)

	for attempt := 1; attempt <= 2; attempt++ {
		outcome, err := f.facade.CancelInvoice(context.Background(), in.CancelInvoiceCommand{OrderID: orderID, Reason: "OUT_OF_STOCK"})
		if err != nil || outcome != in.Recorded {
			t.Fatalf("attempt %d: CancelInvoice() = (%q, %v), want (RECORDED, nil)", attempt, outcome, err)
		}
	}
	if f.cancellations.recorded[orderID] != "OUT_OF_STOCK" {
		t.Fatalf("recorded cancellations = %v, want the order with its reason", f.cancellations.recorded)
	}

	outcome, err := f.facade.IssueInvoice(context.Background(), iphoneOrder(t, model.MercadoLivre))
	if err != nil || outcome != in.OrderCancelled || len(f.repository.saved) != 0 {
		t.Fatalf("IssueInvoice() after the cancellation = (%q, %v) with %d saved, want (ORDER_CANCELLED, nil) and none saved", outcome, err, len(f.repository.saved))
	}
}

// API-01 and API-02
func TestGetInvoiceReturnsTheSnapshotOrANotFoundError(t *testing.T) {
	f := newFixture(t)
	if _, err := f.facade.IssueInvoice(context.Background(), iphoneOrder(t, model.MercadoLivre)); err != nil {
		t.Fatal(err)
	}

	got, err := f.facade.GetInvoice(context.Background(), "invoice-1")
	if err != nil || got.ID != "invoice-1" || got.Total != 1500000 {
		t.Fatalf("GetInvoice(invoice-1) = (%+v, %v), want the invoice of 1500000", got, err)
	}

	_, err = f.facade.GetInvoice(context.Background(), "missing")
	var notFound *domain.NotFoundError
	if !errors.As(err, &notFound) {
		t.Fatalf("GetInvoice(missing) error = %v, want a NotFoundError", err)
	}
}

// API-03
func TestListInvoicesPassesTheQueryToTheRepository(t *testing.T) {
	f := newFixture(t)
	f.repository.listing = []model.Snapshot{{ID: "invoice-2"}, {ID: "invoice-1"}}
	query := model.InvoiceQuery{OrderID: orderID, Status: model.StatusPaid, Marketplace: model.Shopee, Limit: 5, Offset: 10}

	got, err := f.facade.ListInvoices(context.Background(), query)

	if err != nil || f.repository.listed != query {
		t.Fatalf("repository received %+v (err %v), want %+v", f.repository.listed, err, query)
	}
	if ids := []string{got[0].ID, got[1].ID}; !slices.Equal(ids, []string{"invoice-2", "invoice-1"}) {
		t.Fatalf("ListInvoices() ids = %v, want the repository order", ids)
	}
}

func TestTheUseCasesThatWriteRunInOneTransactionEach(t *testing.T) {
	f := newFixture(t)

	if _, err := f.facade.IssueInvoice(context.Background(), iphoneOrder(t, model.MercadoLivre)); err != nil {
		t.Fatal(err)
	}
	if _, err := f.facade.CancelInvoice(context.Background(), in.CancelInvoiceCommand{OrderID: orderID, Reason: "X"}); err != nil {
		t.Fatal(err)
	}

	if f.transactor.calls != 2 {
		t.Fatalf("transactions opened = %d, want 2: one per use case, and the fakes fail outside of them", f.transactor.calls)
	}
}

var (
	_ in.IssueInvoiceUseCase  = (*invoice.Facade)(nil)
	_ in.CancelInvoiceUseCase = (*invoice.Facade)(nil)
	_ in.GetInvoiceUseCase    = (*invoice.Facade)(nil)
	_ in.ListInvoicesUseCase  = (*invoice.Facade)(nil)
)
