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

// PaymentConfirmed is recorded when the PSP reports the payment. The outbox maps
// it to billing.payment.confirmed.v1.
type PaymentConfirmed struct {
	InvoiceID        string
	OrderID          string
	Amount           Money
	PSPTransactionID string
	PaidAt           time.Time
}

func (e PaymentConfirmed) EventName() string     { return "PaymentConfirmed" }
func (e PaymentConfirmed) AggregateID() string   { return e.InvoiceID }
func (e PaymentConfirmed) OccurredAt() time.Time { return e.PaidAt }

// PaymentFailed is recorded when the PSP refuses the payment. The outbox maps it to
// billing.payment.failed.v1. PSPTransactionID is empty when the PSP refused to create the charge.
type PaymentFailed struct {
	InvoiceID        string
	OrderID          string
	Amount           Money
	PSPTransactionID string
	Reason           string
	FailedAt         time.Time
}

func (e PaymentFailed) EventName() string     { return "PaymentFailed" }
func (e PaymentFailed) AggregateID() string   { return e.InvoiceID }
func (e PaymentFailed) OccurredAt() time.Time { return e.FailedAt }
