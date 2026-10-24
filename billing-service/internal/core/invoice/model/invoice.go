package model

import (
	"slices"
	"strings"
	"time"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/shared/domain"
)

// OrderData is what a confirmed order tells the billing.
type OrderData struct {
	OrderID         string
	ExternalOrderID string
	Marketplace     Marketplace
	Items           []Item
	// DeclaredTotal is the total the order-service sent; it must match the items.
	DeclaredTotal Money
}

// Snapshot is the whole state of an invoice, for persistence and for reads.
type Snapshot struct {
	ID                 string
	OrderID            string
	ExternalOrderID    string
	Marketplace        Marketplace
	Items              []Item
	Total              Money
	CommissionRateBps  int
	Commission         Money
	Net                Money
	Status             Status
	IssuedAt           time.Time
	CancelledAt        *time.Time
	CancellationReason string
	UpdatedAt          time.Time
	// Version is the optimistic lock of the row.
	Version int

	// Payment: the charge at the PSP and how the attempts to create it went.
	PSPTransactionID     string
	FailureReason        string
	PaymentAttempts      int
	NextPaymentAttemptAt *time.Time
	PaymentRequestedAt   *time.Time
	PaidAt               *time.Time
	FailedAt             *time.Time
}

// Invoice charges one confirmed order.
type Invoice struct {
	domain.AggregateRoot
	state Snapshot
}

// IssueInvoice creates the invoice of a confirmed order: the total is the sum of
// quantity times unit price, the commission is the rate of the marketplace and the
// net amount is what is left for the store. It records InvoiceIssued.
func IssueInvoice(id string, order OrderData, policy CommissionPolicy, now time.Time) (*Invoice, error) {
	if strings.TrimSpace(id) == "" {
		return nil, domain.NewValidationError("invoice id must not be blank")
	}
	if strings.TrimSpace(order.OrderID) == "" {
		return nil, domain.NewValidationError("order id must not be blank")
	}
	marketplace, err := ParseMarketplace(string(order.Marketplace))
	if err != nil {
		return nil, err
	}
	if len(order.Items) < 1 || len(order.Items) > MaxItemsPerOrder {
		return nil, domain.NewValidationError("an order must have 1 to %d items, got %d", MaxItemsPerOrder, len(order.Items))
	}

	var total Money
	for _, item := range order.Items {
		total = total.Add(item.Amount())
	}
	if order.DeclaredTotal != total {
		return nil, domain.NewValidationError("declared total %s differs from the sum of the items %s", order.DeclaredTotal.Decimal(), total.Decimal())
	}

	commission := policy.Commission(total)
	invoice := &Invoice{state: Snapshot{
		ID:                id,
		OrderID:           order.OrderID,
		ExternalOrderID:   order.ExternalOrderID,
		Marketplace:       marketplace,
		Items:             slices.Clone(order.Items),
		Total:             total,
		CommissionRateBps: policy.RateBps(),
		Commission:        commission,
		Net:               total.Sub(commission),
		Status:            StatusIssued,
		IssuedAt:          now,
		UpdatedAt:         now,
	}}
	invoice.Record(InvoiceIssued{
		InvoiceID:         id,
		OrderID:           order.OrderID,
		ExternalOrderID:   order.ExternalOrderID,
		Marketplace:       marketplace,
		Total:             total,
		Commission:        commission,
		Net:               invoice.state.Net,
		CommissionRateBps: policy.RateBps(),
		IssuedAt:          now,
	})
	return invoice, nil
}

// Restore rebuilds an invoice from its stored state. It records no events: they
// were published when the invoice was issued.
func Restore(snapshot Snapshot) *Invoice {
	return &Invoice{state: copyOf(snapshot)}
}

// Snapshot returns a copy of the state.
func (i *Invoice) Snapshot() Snapshot {
	return copyOf(i.state)
}

func (i *Invoice) ID() string { return i.state.ID }

func (i *Invoice) Status() Status { return i.state.Status }

// Cancel cancels an invoice that is still issued or waiting for the PSP and
// reports whether it changed. A paid, failed or already cancelled invoice keeps
// its state: there is no refund.
func (i *Invoice) Cancel(reason string, now time.Time) bool {
	if i.state.Status != StatusIssued && i.state.Status != StatusPaymentPending {
		return false
	}
	i.state.Status = StatusCancelled
	i.state.CancelledAt = &now
	i.state.CancellationReason = reason
	i.state.UpdatedAt = now
	return true
}

func copyOf(snapshot Snapshot) Snapshot {
	snapshot.Items = slices.Clone(snapshot.Items)
	snapshot.CancelledAt = copyTime(snapshot.CancelledAt)
	snapshot.NextPaymentAttemptAt = copyTime(snapshot.NextPaymentAttemptAt)
	snapshot.PaymentRequestedAt = copyTime(snapshot.PaymentRequestedAt)
	snapshot.PaidAt = copyTime(snapshot.PaidAt)
	snapshot.FailedAt = copyTime(snapshot.FailedAt)
	return snapshot
}

func copyTime(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	copied := *t
	return &copied
}
