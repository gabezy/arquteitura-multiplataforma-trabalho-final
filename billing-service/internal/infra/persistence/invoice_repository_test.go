package persistence_test

import (
	"context"
	"errors"
	"slices"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/model"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/shared/domain"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/outbox"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/persistence"
)

var base = time.Date(2026, 10, 28, 13, 0, 0, 0, time.UTC)

type repositoryFixture struct {
	db           *persistence.Database
	invoices     *persistence.InvoiceRepository
	cancellation *persistence.OrderCancellationRepository
}

// recordingAppender is a persistence.EventAppender that remembers what it was given.
type recordingAppender struct {
	appended []domain.DomainEvent
	err      error
}

func (a *recordingAppender) Append(_ context.Context, events []domain.DomainEvent) error {
	if a.err != nil {
		return a.err
	}
	a.appended = append(a.appended, events...)
	return nil
}

func newRepositoryFixture(t *testing.T, appender persistence.EventAppender) repositoryFixture {
	t.Helper()
	db := openMigrated(t)
	return repositoryFixture{
		db:           db,
		invoices:     persistence.NewInvoiceRepository(db, appender),
		cancellation: persistence.NewOrderCancellationRepository(db),
	}
}

func newInvoice(t *testing.T, marketplace model.Marketplace, at time.Time, items ...model.Item) *model.Invoice {
	t.Helper()
	if len(items) == 0 {
		item, err := model.NewItem("231", 1, 1500000)
		if err != nil {
			t.Fatal(err)
		}
		items = []model.Item{item}
	}
	var total model.Money
	for _, item := range items {
		total = total.Add(item.Amount())
	}
	policy, err := model.NewPercentageCommission(1100)
	if err != nil {
		t.Fatal(err)
	}
	invoice, err := model.IssueInvoice(uuid.NewString(), model.OrderData{
		OrderID: uuid.NewString(), ExternalOrderID: "ML-2000001", Marketplace: marketplace, Items: items, DeclaredTotal: total,
	}, policy, at)
	if err != nil {
		t.Fatal(err)
	}
	return invoice
}

func sameInstant(a, b time.Time) bool { return a.Equal(b) }

func requireSameSnapshot(t *testing.T, got, want model.Snapshot) {
	t.Helper()
	if got.ID != want.ID || got.OrderID != want.OrderID || got.ExternalOrderID != want.ExternalOrderID ||
		got.Marketplace != want.Marketplace || got.Total != want.Total || got.CommissionRateBps != want.CommissionRateBps ||
		got.Commission != want.Commission || got.Net != want.Net || got.Status != want.Status ||
		got.CancellationReason != want.CancellationReason {
		t.Fatalf("snapshot differs:\n got  %+v\n want %+v", got, want)
	}
	if !sameInstant(got.IssuedAt, want.IssuedAt) || !sameInstant(got.UpdatedAt, want.UpdatedAt) {
		t.Fatalf("times differ: issued %v/%v updated %v/%v", got.IssuedAt, want.IssuedAt, got.UpdatedAt, want.UpdatedAt)
	}
	if (got.CancelledAt == nil) != (want.CancelledAt == nil) || (got.CancelledAt != nil && !sameInstant(*got.CancelledAt, *want.CancelledAt)) {
		t.Fatalf("cancelledAt = %v, want %v", got.CancelledAt, want.CancelledAt)
	}
	if !slices.Equal(got.Items, want.Items) {
		t.Fatalf("items = %+v, want %+v", got.Items, want.Items)
	}
}

func TestSaveAndFindReturnTheSameInvoice(t *testing.T) {
	f := newRepositoryFixture(t, &recordingAppender{})
	ctx := context.Background()
	first, _ := model.NewItem("231", 2, 1500050)
	second, _ := model.NewItem("412", 1, 900000)
	invoice := newInvoice(t, model.MercadoLivre, base, first, second)
	want := invoice.Snapshot()

	if err := f.invoices.Save(ctx, invoice); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	byID, err := f.invoices.FindByID(ctx, want.ID)
	if err != nil {
		t.Fatal(err)
	}
	requireSameSnapshot(t, byID.Snapshot(), want)
	if got := byID.Snapshot().Version; got != 1 {
		t.Errorf("Version after the first save = %d, want 1", got)
	}
	byOrder, err := f.invoices.FindByOrderID(ctx, want.OrderID)
	if err != nil {
		t.Fatal(err)
	}
	requireSameSnapshot(t, byOrder.Snapshot(), want)
}

// INV-03: the events of the invoice go to the outbox in the same transaction.
func TestSaveHandsTheRecordedEventsToTheOutboxAppender(t *testing.T) {
	appender := &recordingAppender{}
	f := newRepositoryFixture(t, appender)
	invoice := newInvoice(t, model.Amazon, base)

	if err := f.invoices.Save(context.Background(), invoice); err != nil {
		t.Fatal(err)
	}

	if len(appender.appended) != 1 || appender.appended[0].EventName() != "InvoiceIssued" || appender.appended[0].AggregateID() != invoice.ID() {
		t.Fatalf("appended events = %v, want one InvoiceIssued of the invoice", appender.appended)
	}
}

func TestSaveStoresNothingWhenTheOutboxAppendFails(t *testing.T) {
	boom := errors.New("outbox unavailable")
	f := newRepositoryFixture(t, &recordingAppender{err: boom})
	invoice := newInvoice(t, model.Amazon, base)

	err := f.invoices.Save(context.Background(), invoice)

	if !errors.Is(err, boom) {
		t.Fatalf("Save() error = %v, want %v", err, boom)
	}
	_, err = f.invoices.FindByID(context.Background(), invoice.ID())
	var notFound *domain.NotFoundError
	if !errors.As(err, &notFound) {
		t.Fatalf("FindByID() error = %v, want NotFound: the invoice must roll back with its events", err)
	}
}

// With the real outbox the row lands in the table, next to the invoice.
func TestSaveWritesTheOutboxRowWithTheRealStore(t *testing.T) {
	db := openMigrated(t)
	store := outbox.NewStore(db, func(event domain.DomainEvent) (outbox.IntegrationEvent, error) {
		return outbox.IntegrationEvent{Type: "billing.invoice.issued.v1", AggregateType: "invoice", Data: map[string]string{"invoiceId": event.AggregateID()}}, nil
	})
	invoices := persistence.NewInvoiceRepository(db, store)
	invoice := newInvoice(t, model.Shopee, base)

	if err := invoices.Save(context.Background(), invoice); err != nil {
		t.Fatal(err)
	}

	var eventType, aggregateID string
	err := db.Querier(context.Background()).QueryRow(context.Background(), `SELECT event_type, aggregate_id::text FROM outbox`).Scan(&eventType, &aggregateID)
	if err != nil || eventType != "billing.invoice.issued.v1" || aggregateID != invoice.ID() {
		t.Fatalf("outbox row = (%q, %q, %v), want billing.invoice.issued.v1 of the invoice", eventType, aggregateID, err)
	}
}

// INV-05: one invoice per order, enforced by the unique key.
func TestSaveRejectsASecondInvoiceForTheSameOrderWithAConflictError(t *testing.T) {
	f := newRepositoryFixture(t, &recordingAppender{})
	ctx := context.Background()
	first := newInvoice(t, model.Amazon, base)
	if err := f.invoices.Save(ctx, first); err != nil {
		t.Fatal(err)
	}
	snapshot := first.Snapshot()
	snapshot.ID = uuid.NewString()
	snapshot.Version = 0
	second := model.Restore(snapshot)

	err := f.invoices.Save(ctx, second)

	var conflict *domain.ConflictError
	if !errors.As(err, &conflict) {
		t.Fatalf("Save() error = %v, want a ConflictError", err)
	}
}

func TestSaveUpdatesWithOptimisticLocking(t *testing.T) {
	f := newRepositoryFixture(t, &recordingAppender{})
	ctx := context.Background()
	invoice := newInvoice(t, model.Amazon, base)
	if err := f.invoices.Save(ctx, invoice); err != nil {
		t.Fatal(err)
	}
	winner, err := f.invoices.FindByID(ctx, invoice.ID())
	if err != nil {
		t.Fatal(err)
	}
	loser, err := f.invoices.FindByID(ctx, invoice.ID())
	if err != nil {
		t.Fatal(err)
	}

	winner.Cancel("OUT_OF_STOCK", base.Add(time.Minute))
	if err := f.invoices.Save(ctx, winner); err != nil {
		t.Fatalf("first update error = %v", err)
	}
	loser.Cancel("PAYMENT_FAILED", base.Add(2*time.Minute))
	err = f.invoices.Save(ctx, loser)

	var conflict *domain.ConflictError
	if !errors.As(err, &conflict) {
		t.Fatalf("stale update error = %v, want a ConflictError", err)
	}
	stored, err := f.invoices.FindByID(ctx, invoice.ID())
	if err != nil {
		t.Fatal(err)
	}
	got := stored.Snapshot()
	if got.Status != model.StatusCancelled || got.CancellationReason != "OUT_OF_STOCK" || got.Version != 2 {
		t.Fatalf("stored invoice = status %q reason %q version %d, want CANCELLED, OUT_OF_STOCK and version 2", got.Status, got.CancellationReason, got.Version)
	}
}

// API-02: an unknown id, even one that is not a UUID, is a NotFoundError and not a database error.
func TestFindReturnsANotFoundErrorForUnknownInvoices(t *testing.T) {
	f := newRepositoryFixture(t, &recordingAppender{})
	ctx := context.Background()

	for name, find := range map[string]func() error{
		"id":               func() error { _, err := f.invoices.FindByID(ctx, uuid.NewString()); return err },
		"id not a uuid":    func() error { _, err := f.invoices.FindByID(ctx, "not-a-uuid"); return err },
		"order":            func() error { _, err := f.invoices.FindByOrderID(ctx, uuid.NewString()); return err },
		"order not a uuid": func() error { _, err := f.invoices.FindByOrderID(ctx, "42"); return err },
	} {
		var notFound *domain.NotFoundError
		if err := find(); !errors.As(err, &notFound) {
			t.Errorf("%s: error = %v, want a NotFoundError", name, err)
		}
	}
}

// API-03: filters, newest first, pagination.
func TestListFiltersPagesAndOrdersNewestFirst(t *testing.T) {
	f := newRepositoryFixture(t, &recordingAppender{})
	ctx := context.Background()
	marketplaces := []model.Marketplace{model.Amazon, model.MercadoLivre, model.Amazon, model.Shopee, model.Amazon}
	var snapshots []model.Snapshot
	for i, marketplace := range marketplaces {
		invoice := newInvoice(t, marketplace, base.Add(time.Duration(i)*time.Minute))
		if i == 2 {
			invoice.Cancel("OUT_OF_STOCK", base.Add(time.Hour))
		}
		if err := f.invoices.Save(ctx, invoice); err != nil {
			t.Fatal(err)
		}
		snapshots = append(snapshots, invoice.Snapshot())
	}
	ids := func(list []model.Snapshot) []string {
		out := make([]string, len(list))
		for i, s := range list {
			out[i] = s.ID
		}
		return out
	}
	want := func(indexes ...int) []string {
		out := make([]string, len(indexes))
		for i, index := range indexes {
			out[i] = snapshots[index].ID
		}
		return out
	}

	tests := []struct {
		name  string
		query model.InvoiceQuery
		want  []string
	}{
		{"everything, newest first", model.InvoiceQuery{Limit: 10}, want(4, 3, 2, 1, 0)},
		{"by marketplace", model.InvoiceQuery{Marketplace: model.Amazon, Limit: 10}, want(4, 2, 0)},
		{"by status", model.InvoiceQuery{Status: model.StatusCancelled, Limit: 10}, want(2)},
		{"by order", model.InvoiceQuery{OrderID: snapshots[1].OrderID, Limit: 10}, want(1)},
		{"by marketplace and status", model.InvoiceQuery{Marketplace: model.Amazon, Status: model.StatusIssued, Limit: 10}, want(4, 0)},
		{"first page", model.InvoiceQuery{Limit: 2}, want(4, 3)},
		{"second page", model.InvoiceQuery{Limit: 2, Offset: 2}, want(2, 1)},
		{"last page", model.InvoiceQuery{Limit: 2, Offset: 4}, want(0)},
		{"past the end", model.InvoiceQuery{Limit: 2, Offset: 10}, nil},
		{"no filter matches", model.InvoiceQuery{Status: model.StatusPaid, Limit: 10}, nil},
		{"order id that is not a uuid", model.InvoiceQuery{OrderID: "42", Limit: 10}, nil},
		{"no limit means the default of 20", model.InvoiceQuery{}, want(4, 3, 2, 1, 0)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := f.invoices.List(ctx, tt.query)
			if err != nil {
				t.Fatalf("List() error = %v", err)
			}
			if !slices.Equal(ids(got), tt.want) {
				t.Fatalf("List(%+v) ids = %v, want %v", tt.query, ids(got), tt.want)
			}
		})
	}

	listed, err := f.invoices.List(ctx, model.InvoiceQuery{Limit: 1})
	if err != nil || len(listed) != 1 || len(listed[0].Items) != 1 || listed[0].Items[0].SKU != "231" {
		t.Fatalf("a listed invoice = %+v (err %v), want its items loaded", listed, err)
	}
}

func TestListLoadsTheItemsOfEveryInvoiceInOrder(t *testing.T) {
	f := newRepositoryFixture(t, &recordingAppender{})
	ctx := context.Background()
	for i := 0; i < 3; i++ {
		var items []model.Item
		for line := 0; line <= i; line++ {
			item, _ := model.NewItem("SKU-"+strconv.Itoa(line), line+1, 1000)
			items = append(items, item)
		}
		if err := f.invoices.Save(ctx, newInvoice(t, model.Amazon, base.Add(time.Duration(i)*time.Minute), items...)); err != nil {
			t.Fatal(err)
		}
	}

	listed, err := f.invoices.List(ctx, model.InvoiceQuery{Limit: 10})
	if err != nil || len(listed) != 3 {
		t.Fatalf("List() = %d invoices (err %v), want 3", len(listed), err)
	}
	for i, snapshot := range listed { // newest first: 3 items, 2 items, 1 item
		wantItems := 3 - i
		if len(snapshot.Items) != wantItems {
			t.Fatalf("invoice %d has %d items, want %d", i, len(snapshot.Items), wantItems)
		}
		for line, item := range snapshot.Items {
			if item.SKU != "SKU-"+strconv.Itoa(line) || item.Quantity != line+1 {
				t.Fatalf("invoice %d item %d = %+v, want SKU-%d with quantity %d", i, line, item, line, line+1)
			}
		}
	}
}

// INV-09: the cancellation of an order without invoice is recorded once.
func TestOrderCancellationsRecordIsIdempotent(t *testing.T) {
	f := newRepositoryFixture(t, &recordingAppender{})
	ctx := context.Background()
	orderID := uuid.NewString()

	if cancelled, err := f.cancellation.IsCancelled(ctx, orderID); err != nil || cancelled {
		t.Fatalf("IsCancelled() before = (%v, %v), want (false, nil)", cancelled, err)
	}
	if err := f.cancellation.Record(ctx, orderID, "OUT_OF_STOCK", base); err != nil {
		t.Fatal(err)
	}
	if err := f.cancellation.Record(ctx, orderID, "PAYMENT_FAILED", base.Add(time.Hour)); err != nil {
		t.Fatalf("recording twice error = %v, want nil", err)
	}

	if cancelled, err := f.cancellation.IsCancelled(ctx, orderID); err != nil || !cancelled {
		t.Fatalf("IsCancelled() after = (%v, %v), want (true, nil)", cancelled, err)
	}
	var reason string
	err := f.db.Querier(ctx).QueryRow(ctx, `SELECT reason FROM order_cancellations WHERE order_id = $1`, orderID).Scan(&reason)
	if err != nil || reason != "OUT_OF_STOCK" {
		t.Fatalf("stored reason = (%q, %v), want the first one, OUT_OF_STOCK", reason, err)
	}
}

func TestOrderCancellationsDoNotReportOrdersThatWereNotCancelled(t *testing.T) {
	f := newRepositoryFixture(t, &recordingAppender{})
	ctx := context.Background()
	if err := f.cancellation.Record(ctx, uuid.NewString(), "OUT_OF_STOCK", base); err != nil {
		t.Fatal(err)
	}

	cancelled, err := f.cancellation.IsCancelled(ctx, uuid.NewString())
	if err != nil || cancelled {
		t.Fatalf("IsCancelled(other order) = (%v, %v), want (false, nil)", cancelled, err)
	}
	if cancelled, err := f.cancellation.IsCancelled(ctx, "not-a-uuid"); err != nil || cancelled {
		t.Fatalf("IsCancelled(not a uuid) = (%v, %v), want (false, nil)", cancelled, err)
	}
}
