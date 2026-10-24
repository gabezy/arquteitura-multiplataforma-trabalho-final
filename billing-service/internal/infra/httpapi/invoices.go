package httpapi

import (
	"encoding/json"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/google/uuid"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/model"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/port/in"
)

const (
	defaultPageSize = 20
	maxPageSize     = 100
)

var invoiceStatuses = []model.Status{
	model.StatusIssued, model.StatusPaymentPending, model.StatusPaid, model.StatusPaymentFailed, model.StatusCancelled,
}

// InvoiceQueries are the read use cases of the invoice.
type InvoiceQueries interface {
	in.GetInvoiceUseCase
	in.ListInvoicesUseCase
}

type itemResponse struct {
	SKU       string      `json:"sku"`
	Quantity  int         `json:"quantity"`
	UnitPrice json.Number `json:"unitPrice"`
	Amount    json.Number `json:"amount"`
}

// invoiceResponse is the JSON of an invoice. Money is a JSON number with two decimals,
// written from integer cents.
type invoiceResponse struct {
	ID                 string         `json:"id"`
	OrderID            string         `json:"orderId"`
	ExternalOrderID    *string        `json:"externalOrderId"`
	Marketplace        string         `json:"marketplace"`
	Status             string         `json:"status"`
	Amount             json.Number    `json:"amount"`
	CommissionPercent  json.Number    `json:"commissionPercent"`
	CommissionAmount   json.Number    `json:"commissionAmount"`
	NetAmount          json.Number    `json:"netAmount"`
	Items              []itemResponse `json:"items"`
	IssuedAt           string         `json:"issuedAt"`
	CancelledAt        *string        `json:"cancelledAt"`
	CancellationReason *string        `json:"cancellationReason"`
}

type invoiceListResponse struct {
	Invoices []invoiceResponse `json:"invoices"`
	Limit    int               `json:"limit"`
	Offset   int               `json:"offset"`
}

func (r *Router) getInvoice(w http.ResponseWriter, req *http.Request) error {
	snapshot, err := r.deps.Invoices.GetInvoice(req.Context(), req.PathValue("id"))
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, toInvoiceResponse(snapshot))
	return nil
}

func (r *Router) listInvoices(w http.ResponseWriter, req *http.Request) error {
	query, err := parseInvoiceQuery(req)
	if err != nil {
		return err
	}
	snapshots, err := r.deps.Invoices.ListInvoices(req.Context(), query)
	if err != nil {
		return err
	}

	invoices := make([]invoiceResponse, 0, len(snapshots))
	for _, snapshot := range snapshots {
		invoices = append(invoices, toInvoiceResponse(snapshot))
	}
	writeJSON(w, http.StatusOK, invoiceListResponse{Invoices: invoices, Limit: query.Limit, Offset: query.Offset})
	return nil
}

// parseInvoiceQuery reads the filters and the page. Every invalid parameter is named in the 400.
func parseInvoiceQuery(req *http.Request) (model.InvoiceQuery, error) {
	values := req.URL.Query()
	query := model.InvoiceQuery{Limit: defaultPageSize}
	var invalid []string

	if values.Has("orderId") {
		if _, err := uuid.Parse(values.Get("orderId")); err != nil {
			invalid = append(invalid, "orderId")
		}
		query.OrderID = values.Get("orderId")
	}
	if values.Has("status") {
		status := model.Status(values.Get("status"))
		if !slices.Contains(invoiceStatuses, status) {
			invalid = append(invalid, "status")
		}
		query.Status = status
	}
	if values.Has("marketplace") {
		marketplace, err := model.ParseMarketplace(values.Get("marketplace"))
		if err != nil {
			invalid = append(invalid, "marketplace")
		}
		query.Marketplace = marketplace
	}
	if values.Has("limit") {
		limit, err := strconv.Atoi(values.Get("limit"))
		if err != nil || limit < 1 || limit > maxPageSize {
			invalid = append(invalid, "limit")
		}
		query.Limit = limit
	}
	if values.Has("offset") {
		offset, err := strconv.Atoi(values.Get("offset"))
		if err != nil || offset < 0 {
			invalid = append(invalid, "offset")
		}
		query.Offset = offset
	}

	if len(invalid) > 0 {
		return model.InvoiceQuery{}, &requestError{
			Message: "invalid query parameters: limit must be 1 to 100, offset 0 or more, and status, marketplace and orderId valid values",
			Issues:  invalid,
		}
	}
	return query, nil
}

func toInvoiceResponse(s model.Snapshot) invoiceResponse {
	items := make([]itemResponse, len(s.Items))
	for i, item := range s.Items {
		items[i] = itemResponse{
			SKU:       item.SKU,
			Quantity:  item.Quantity,
			UnitPrice: json.Number(item.UnitPrice.Decimal()),
			Amount:    json.Number(item.Amount().Decimal()),
		}
	}
	return invoiceResponse{
		ID:                 s.ID,
		OrderID:            s.OrderID,
		ExternalOrderID:    nullable(s.ExternalOrderID),
		Marketplace:        string(s.Marketplace),
		Status:             string(s.Status),
		Amount:             json.Number(s.Total.Decimal()),
		CommissionPercent:  json.Number(model.PercentDecimal(s.CommissionRateBps)),
		CommissionAmount:   json.Number(s.Commission.Decimal()),
		NetAmount:          json.Number(s.Net.Decimal()),
		Items:              items,
		IssuedAt:           formatTime(s.IssuedAt),
		CancelledAt:        formatOptionalTime(s.CancelledAt),
		CancellationReason: nullable(s.CancellationReason),
	}
}

func nullable(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func formatTime(t time.Time) string {
	return t.UTC().Format(time.RFC3339Nano)
}

func formatOptionalTime(t *time.Time) *string {
	if t == nil {
		return nil
	}
	formatted := formatTime(*t)
	return &formatted
}
