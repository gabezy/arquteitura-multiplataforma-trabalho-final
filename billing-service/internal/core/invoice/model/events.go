package model

import "time"

// InvoiceIssued is recorded when an invoice is created. The outbox maps it to
// billing.invoice.issued.v1.
type InvoiceIssued struct {
	InvoiceID         string
	OrderID           string
	ExternalOrderID   string
	Marketplace       Marketplace
	Total             Money
	Commission        Money
	Net               Money
	CommissionRateBps int
	IssuedAt          time.Time
}

func (e InvoiceIssued) EventName() string     { return "InvoiceIssued" }
func (e InvoiceIssued) AggregateID() string   { return e.InvoiceID }
func (e InvoiceIssued) OccurredAt() time.Time { return e.IssuedAt }
