package model_test

import (
	"errors"
	"reflect"
	"strconv"
	"testing"
	"time"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/model"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/shared/domain"
)

var issuedAt = time.Date(2026, 10, 28, 13, 5, 3, 0, time.UTC)

const (
	invoiceID = "a3c1d5e2-7b4f-4c8a-9e10-2d3f4a5b6c7d"
	orderID   = "6f1c2b8e-0000-4000-8000-000000000001"
)

func policyOf(t *testing.T, rateBps int) model.CommissionPolicy {
	t.Helper()
	policy, err := model.NewPercentageCommission(rateBps)
	if err != nil {
		t.Fatal(err)
	}
	return policy
}

func itemOf(t *testing.T, sku string, quantity int, price model.Money) model.Item {
	t.Helper()
	item, err := model.NewItem(sku, quantity, price)
	if err != nil {
		t.Fatal(err)
	}
	return item
}

func orderOf(marketplace model.Marketplace, declaredTotal model.Money, items ...model.Item) model.OrderData {
	return model.OrderData{
		OrderID:         orderID,
		ExternalOrderID: "ML-2000001",
		Marketplace:     marketplace,
		Items:           items,
		DeclaredTotal:   declaredTotal,
	}
}

func issue(t *testing.T, order model.OrderData, rateBps int) *model.Invoice {
	t.Helper()
	invoice, err := model.IssueInvoice(invoiceID, order, policyOf(t, rateBps), issuedAt)
	if err != nil {
		t.Fatalf("IssueInvoice() error = %v", err)
	}
	return invoice
}

// INV-01 and INV-02: the demo invoice, one iPhone sold on Mercado Livre at 11%.
func TestIssueInvoiceChargesTheOrderTotalAndRecordsCommissionAndNet(t *testing.T) {
	iphone := itemOf(t, "231", 1, 1500000)

	invoice := issue(t, orderOf(model.MercadoLivre, 1500000, iphone), 1100)

	got := invoice.Snapshot()
	if got.Status != model.StatusIssued {
		t.Errorf("Status = %q, want ISSUED", got.Status)
	}
	if got.Total != 1500000 || got.Commission != 165000 || got.Net != 1335000 || got.CommissionRateBps != 1100 {
		t.Errorf("total/commission/net/rate = %d/%d/%d/%d, want 1500000/165000/1335000/1100",
			got.Total, got.Commission, got.Net, got.CommissionRateBps)
	}
	if got.ID != invoiceID || got.OrderID != orderID || got.ExternalOrderID != "ML-2000001" || got.Marketplace != model.MercadoLivre {
		t.Errorf("identity = %+v", got)
	}
	if !got.IssuedAt.Equal(issuedAt) || !got.UpdatedAt.Equal(issuedAt) || got.CancelledAt != nil || got.CancellationReason != "" {
		t.Errorf("dates and cancellation = issued %v updated %v cancelledAt %v reason %q", got.IssuedAt, got.UpdatedAt, got.CancelledAt, got.CancellationReason)
	}
	wantItems := []model.Item{iphone}
	if !reflect.DeepEqual(got.Items, wantItems) {
		t.Errorf("Items = %+v, want %+v", got.Items, wantItems)
	}
}

func TestIssueInvoiceSumsQuantityTimesUnitPriceOfEveryItem(t *testing.T) {
	order := orderOf(model.Amazon, 3900000,
		itemOf(t, "231", 2, 1500000),
		itemOf(t, "412", 1, 900000),
	)

	got := issue(t, order, 1200).Snapshot()

	if got.Total != 3900000 || got.Commission != 468000 || got.Net != 3432000 {
		t.Fatalf("total/commission/net = %d/%d/%d, want 3900000/468000/3432000", got.Total, got.Commission, got.Net)
	}
}

// Edge case of the spec: half a cent rounds up.
func TestIssueInvoiceRoundsAHalfCentCommissionUp(t *testing.T) {
	order := orderOf(model.Shopee, 25, itemOf(t, "SKU-1", 1, 25))

	got := issue(t, order, 1400).Snapshot()

	if got.Commission != 4 || got.Net != 21 {
		t.Fatalf("commission/net = %d/%d cents, want 4/21 (R$ 0,04 and R$ 0,21)", got.Commission, got.Net)
	}
}

func TestIssueInvoiceAcceptsTheLargestOrderOfTheSpec(t *testing.T) {
	items := make([]model.Item, model.MaxItemsPerOrder)
	for i := range items {
		items[i] = itemOf(t, "SKU-"+strconv.Itoa(i), 1, 100)
	}

	invoice, err := model.IssueInvoice(invoiceID, orderOf(model.Amazon, 100*100, items...), policyOf(t, 1200), issuedAt)

	if err != nil || invoice.Snapshot().Total != 10000 {
		t.Fatalf("IssueInvoice() = (%v, %v), want an invoice of 10000 cents for 100 items", invoice, err)
	}
}

// INV-03: the invoice records the event that the outbox publishes.
func TestIssueInvoiceRecordsOneInvoiceIssuedEvent(t *testing.T) {
	invoice := issue(t, orderOf(model.MercadoLivre, 1500000, itemOf(t, "231", 1, 1500000)), 1100)

	events := invoice.PullEvents()

	if len(events) != 1 {
		t.Fatalf("recorded %d events, want 1", len(events))
	}
	want := model.InvoiceIssued{
		InvoiceID:         invoiceID,
		OrderID:           orderID,
		ExternalOrderID:   "ML-2000001",
		Marketplace:       model.MercadoLivre,
		Total:             1500000,
		Commission:        165000,
		Net:               1335000,
		CommissionRateBps: 1100,
		IssuedAt:          issuedAt,
	}
	got, ok := events[0].(model.InvoiceIssued)
	if !ok || got != want {
		t.Fatalf("event = %#v, want %#v", events[0], want)
	}
	if got.EventName() != "InvoiceIssued" || got.AggregateID() != invoiceID || !got.OccurredAt().Equal(issuedAt) {
		t.Errorf("event name/aggregate/time = %q/%q/%v", got.EventName(), got.AggregateID(), got.OccurredAt())
	}
	if again := invoice.PullEvents(); len(again) != 0 {
		t.Errorf("a second PullEvents() = %v, want none", again)
	}
}

// INV-06 at the core: what the facade must reject, so that the consumer sends it to the dead letter.
func TestIssueInvoiceRejectsInvalidOrders(t *testing.T) {
	one := func() model.Item { return itemOf(t, "231", 1, 1500000) }
	tooMany := make([]model.Item, model.MaxItemsPerOrder+1)
	for i := range tooMany {
		tooMany[i] = itemOf(t, "SKU-"+strconv.Itoa(i), 1, 100)
	}

	tests := []struct {
		name      string
		invoiceID string
		order     model.OrderData
	}{
		{"no items", invoiceID, orderOf(model.Amazon, 0)},
		{"more than 100 items", invoiceID, orderOf(model.Amazon, 101*100, tooMany...)},
		{"declared total below the sum of the items", invoiceID, orderOf(model.Amazon, 1499999, one())},
		{"declared total above the sum of the items", invoiceID, orderOf(model.Amazon, 1500001, one())},
		{"unknown marketplace", invoiceID, orderOf("EBAY", 1500000, one())},
		{"blank order id", invoiceID, model.OrderData{Marketplace: model.Amazon, Items: []model.Item{one()}, DeclaredTotal: 1500000}},
		{"blank invoice id", " ", orderOf(model.Amazon, 1500000, one())},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			invoice, err := model.IssueInvoice(tt.invoiceID, tt.order, policyOf(t, 1100), issuedAt)

			var validation *domain.ValidationError
			if !errors.As(err, &validation) {
				t.Fatalf("IssueInvoice() error = %v, want a ValidationError", err)
			}
			if invoice != nil {
				t.Fatalf("IssueInvoice() returned an invoice with an error: %+v", invoice)
			}
		})
	}
}

func restored(t *testing.T, status model.Status) *model.Invoice {
	t.Helper()
	snapshot := issue(t, orderOf(model.MercadoLivre, 1500000, itemOf(t, "231", 1, 1500000)), 1100).Snapshot()
	snapshot.Status = status
	if status == model.StatusCancelled {
		cancelledAt := issuedAt.Add(time.Minute)
		snapshot.CancelledAt = &cancelledAt
		snapshot.CancellationReason = "OUT_OF_STOCK"
	}
	return model.Restore(snapshot)
}

// INV-08: the invoices that can still be cancelled.
func TestCancelChangesAnInvoiceThatIsIssuedOrPaymentPending(t *testing.T) {
	cancelAt := issuedAt.Add(2 * time.Minute)
	for _, status := range []model.Status{model.StatusIssued, model.StatusPaymentPending} {
		t.Run(string(status), func(t *testing.T) {
			invoice := restored(t, status)

			changed := invoice.Cancel("PAYMENT_FAILED", cancelAt)

			got := invoice.Snapshot()
			if !changed || got.Status != model.StatusCancelled {
				t.Fatalf("Cancel() = %v, status %q, want true and CANCELLED", changed, got.Status)
			}
			if got.CancelledAt == nil || !got.CancelledAt.Equal(cancelAt) || got.CancellationReason != "PAYMENT_FAILED" || !got.UpdatedAt.Equal(cancelAt) {
				t.Errorf("cancelledAt/reason/updatedAt = %v/%q/%v, want %v/PAYMENT_FAILED/%v", got.CancelledAt, got.CancellationReason, got.UpdatedAt, cancelAt, cancelAt)
			}
		})
	}
}

// INV-11: a paid, failed or already cancelled invoice keeps everything.
func TestCancelKeepsAnInvoiceThatIsPaidFailedOrAlreadyCancelled(t *testing.T) {
	for _, status := range []model.Status{model.StatusPaid, model.StatusPaymentFailed, model.StatusCancelled} {
		t.Run(string(status), func(t *testing.T) {
			invoice := restored(t, status)
			before := invoice.Snapshot()

			changed := invoice.Cancel("PAYMENT_FAILED", issuedAt.Add(time.Hour))

			if changed {
				t.Fatal("Cancel() = true, want false")
			}
			if after := invoice.Snapshot(); !reflect.DeepEqual(after, before) {
				t.Fatalf("snapshot changed:\n before %+v\n after  %+v", before, after)
			}
		})
	}
}

func TestSnapshotAndRestoreRoundTripWithoutEvents(t *testing.T) {
	invoice := issue(t, orderOf(model.Amazon, 3900000, itemOf(t, "231", 2, 1500000), itemOf(t, "412", 1, 900000)), 1200)
	want := invoice.Snapshot()

	back := model.Restore(want)

	if got := back.Snapshot(); !reflect.DeepEqual(got, want) {
		t.Fatalf("round trip changed the snapshot:\n got  %+v\n want %+v", got, want)
	}
	if events := back.PullEvents(); len(events) != 0 {
		t.Fatalf("a restored invoice recorded %d events, want none: they were published when it was issued", len(events))
	}
}

func TestSnapshotItemsAreACopy(t *testing.T) {
	invoice := issue(t, orderOf(model.Amazon, 1500000, itemOf(t, "231", 1, 1500000)), 1200)

	invoice.Snapshot().Items[0].Quantity = 99

	if got := invoice.Snapshot().Items[0].Quantity; got != 1 {
		t.Fatalf("quantity after changing a snapshot = %d, want 1", got)
	}
}

func TestStatusIsFinalOnlyOncePaidFailedOrCancelled(t *testing.T) {
	want := map[model.Status]bool{
		model.StatusIssued:         false,
		model.StatusPaymentPending: false,
		model.StatusPaid:           true,
		model.StatusPaymentFailed:  true,
		model.StatusCancelled:      true,
	}
	for status, final := range want {
		if status.IsFinal() != final {
			t.Errorf("%s.IsFinal() = %v, want %v", status, status.IsFinal(), final)
		}
	}
}
