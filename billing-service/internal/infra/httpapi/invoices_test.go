package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/model"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/shared/domain"
)

const (
	testInvoiceID = "a3c1d5e2-7b4f-4c8a-9e10-2d3f4a5b6c7d"
	testOrderID   = "6f1c2b8e-0000-4000-8000-000000000001"
)

type fakeInvoices struct {
	snapshots map[string]model.Snapshot
	listing   []model.Snapshot
	listed    []model.InvoiceQuery
	err       error
}

func (f *fakeInvoices) GetInvoice(_ context.Context, id string) (model.Snapshot, error) {
	if f.err != nil {
		return model.Snapshot{}, f.err
	}
	snapshot, ok := f.snapshots[id]
	if !ok {
		return model.Snapshot{}, domain.NewNotFoundError("invoice %s not found", id)
	}
	return snapshot, nil
}

func (f *fakeInvoices) ListInvoices(_ context.Context, query model.InvoiceQuery) ([]model.Snapshot, error) {
	f.listed = append(f.listed, query)
	return f.listing, f.err
}

func issuedSnapshot() model.Snapshot {
	at := time.Date(2026, 10, 28, 13, 5, 3, 0, time.UTC)
	return model.Snapshot{
		ID:                testInvoiceID,
		OrderID:           testOrderID,
		ExternalOrderID:   "ML-2000001",
		Marketplace:       model.MercadoLivre,
		Items:             []model.Item{{SKU: "231", Quantity: 2, UnitPrice: 1500050}, {SKU: "412", Quantity: 1, UnitPrice: 900000}},
		Total:             3900100,
		CommissionRateBps: 1100,
		Commission:        429011,
		Net:               3471089,
		Status:            model.StatusIssued,
		IssuedAt:          at,
		UpdatedAt:         at,
		Version:           1,
	}
}

func invoiceRouter(f *fakeInvoices) *Router {
	return newTestRouter(Deps{Invoices: f})
}

// API-01: the invoice with its items and amounts, money as numbers with two decimals.
func TestGetInvoiceReturnsTheInvoiceWithItsItemsAndAmounts(t *testing.T) {
	f := &fakeInvoices{snapshots: map[string]model.Snapshot{testInvoiceID: issuedSnapshot()}}

	rec := do(invoiceRouter(f), http.MethodGet, "/invoices/"+testInvoiceID)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body)
	}
	if got := rec.Header().Get("Content-Type"); !strings.HasPrefix(got, "application/json") {
		t.Errorf("Content-Type = %q, want application/json", got)
	}
	want := `{"id":"a3c1d5e2-7b4f-4c8a-9e10-2d3f4a5b6c7d","orderId":"6f1c2b8e-0000-4000-8000-000000000001","externalOrderId":"ML-2000001",` +
		`"marketplace":"MERCADO_LIVRE","status":"ISSUED","amount":39001.00,"commissionPercent":11.00,"commissionAmount":4290.11,"netAmount":34710.89,` +
		`"items":[{"sku":"231","quantity":2,"unitPrice":15000.50,"amount":30001.00},{"sku":"412","quantity":1,"unitPrice":9000.00,"amount":9000.00}],` +
		`"issuedAt":"2026-10-28T13:05:03Z","cancelledAt":null,"cancellationReason":null}`
	if got := strings.TrimSpace(rec.Body.String()); got != want {
		t.Fatalf("body =\n %s\nwant\n %s", got, want)
	}
}

func TestGetInvoiceShowsTheCancellationOfACancelledInvoice(t *testing.T) {
	snapshot := issuedSnapshot()
	snapshot.ExternalOrderID = ""
	snapshot.Status = model.StatusCancelled
	cancelledAt := time.Date(2026, 10, 28, 13, 10, 0, 0, time.UTC)
	snapshot.CancelledAt = &cancelledAt
	snapshot.CancellationReason = "OUT_OF_STOCK"
	f := &fakeInvoices{snapshots: map[string]model.Snapshot{testInvoiceID: snapshot}}

	rec := do(invoiceRouter(f), http.MethodGet, "/invoices/"+testInvoiceID)

	body := decode(t, rec)
	if body["status"] != "CANCELLED" || body["cancelledAt"] != "2026-10-28T13:10:00Z" || body["cancellationReason"] != "OUT_OF_STOCK" {
		t.Errorf("cancellation fields = %v/%v/%v, want CANCELLED, 2026-10-28T13:10:00Z, OUT_OF_STOCK", body["status"], body["cancelledAt"], body["cancellationReason"])
	}
	if value, present := body["externalOrderId"]; !present || value != nil {
		t.Errorf("externalOrderId = %v (present %v), want null when the order has none", value, present)
	}
}

// API-02
func TestGetInvoiceRespondsNotFoundAsProblemDetails(t *testing.T) {
	rec := do(invoiceRouter(&fakeInvoices{}), http.MethodGet, "/invoices/"+testInvoiceID)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/problem+json" {
		t.Errorf("Content-Type = %q, want application/problem+json", got)
	}
	if body := decode(t, rec); body["status"] != float64(404) || body["detail"] != "invoice "+testInvoiceID+" not found" {
		t.Errorf("problem = %v, want status 404 and the not found detail", body)
	}
}

// API-03: filters, pagination and the echo of the page.
func TestListInvoicesPassesTheFiltersAndThePageToTheUseCase(t *testing.T) {
	f := &fakeInvoices{listing: []model.Snapshot{issuedSnapshot()}}
	target := "/invoices?" + url.Values{
		"orderId": {testOrderID}, "status": {"PAID"}, "marketplace": {"SHOPEE"}, "limit": {"5"}, "offset": {"10"},
	}.Encode()

	rec := do(invoiceRouter(f), http.MethodGet, target)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body)
	}
	want := model.InvoiceQuery{OrderID: testOrderID, Status: model.StatusPaid, Marketplace: model.Shopee, Limit: 5, Offset: 10}
	if len(f.listed) != 1 || f.listed[0] != want {
		t.Fatalf("use case received %+v, want %+v", f.listed, want)
	}
	body := decode(t, rec)
	invoices, _ := body["invoices"].([]any)
	if len(invoices) != 1 || body["limit"] != float64(5) || body["offset"] != float64(10) {
		t.Fatalf("body = %v, want one invoice with limit 5 and offset 10", body)
	}
	if first, _ := invoices[0].(map[string]any); first["id"] != testInvoiceID {
		t.Errorf("first invoice = %v, want %s", first, testInvoiceID)
	}
}

func TestListInvoicesDefaultsToTwentyFromTheStartWithoutFilters(t *testing.T) {
	f := &fakeInvoices{}

	rec := do(invoiceRouter(f), http.MethodGet, "/invoices")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if want := (model.InvoiceQuery{Limit: 20}); f.listed[0] != want {
		t.Fatalf("use case received %+v, want %+v", f.listed[0], want)
	}
	if body := strings.TrimSpace(rec.Body.String()); body != `{"invoices":[],"limit":20,"offset":0}` {
		t.Fatalf("body = %s, want an empty list and not null", body)
	}
}

func TestListInvoicesAcceptsTheLimitsOfThePage(t *testing.T) {
	for _, limit := range []string{"1", "100"} {
		f := &fakeInvoices{}
		if rec := do(invoiceRouter(f), http.MethodGet, "/invoices?limit="+limit+"&offset=0"); rec.Code != http.StatusOK {
			t.Errorf("limit=%s: status = %d, want 200", limit, rec.Code)
		}
	}
}

// API-04: what is out of range or unknown is a 400 that names the parameter, and the use case is not called.
func TestListInvoicesRejectsInvalidParametersAsBadRequest(t *testing.T) {
	tests := []struct {
		query string
		param string
	}{
		{"limit=0", "limit"},
		{"limit=101", "limit"},
		{"limit=-1", "limit"},
		{"limit=abc", "limit"},
		{"limit=", "limit"},
		{"offset=-1", "offset"},
		{"offset=abc", "offset"},
		{"status=UNKNOWN", "status"},
		{"status=paid", "status"},
		{"marketplace=EBAY", "marketplace"},
		{"orderId=42", "orderId"},
	}
	for _, tt := range tests {
		t.Run(tt.query, func(t *testing.T) {
			f := &fakeInvoices{}

			rec := do(invoiceRouter(f), http.MethodGet, "/invoices?"+tt.query)

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400: %s", rec.Code, rec.Body)
			}
			if got := rec.Header().Get("Content-Type"); got != "application/problem+json" {
				t.Errorf("Content-Type = %q, want application/problem+json", got)
			}
			issues, _ := decode(t, rec)["errors"].([]any)
			if len(issues) != 1 || issues[0] != tt.param {
				t.Errorf("errors = %v, want [%s]", issues, tt.param)
			}
			if len(f.listed) != 0 {
				t.Errorf("the use case was called with %+v for an invalid request", f.listed)
			}
		})
	}
}

func TestListInvoicesNamesEveryInvalidParameterTogether(t *testing.T) {
	rec := do(invoiceRouter(&fakeInvoices{}), http.MethodGet, "/invoices?limit=0&status=NOPE")

	issues, _ := decode(t, rec)["errors"].([]any)
	if rec.Code != http.StatusBadRequest || len(issues) != 2 {
		t.Fatalf("status = %d, errors = %v, want 400 naming both limit and status", rec.Code, issues)
	}
}

func TestInvoiceRoutesNeverLeakAnUnexpectedError(t *testing.T) {
	f := &fakeInvoices{err: errors.New("password authentication failed for user billing")}

	for _, target := range []string{"/invoices", "/invoices/" + testInvoiceID} {
		rec := do(invoiceRouter(f), http.MethodGet, target)

		if rec.Code != http.StatusInternalServerError || strings.Contains(rec.Body.String(), "password") {
			t.Errorf("%s: status = %d, body = %s, want 500 without the message", target, rec.Code, rec.Body)
		}
	}
}

func TestInvoiceRoutesAreAbsentWithoutTheUseCases(t *testing.T) {
	rec := do(newTestRouter(Deps{}), http.MethodGet, "/invoices")

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 for a router without invoice use cases", rec.Code)
	}
}
