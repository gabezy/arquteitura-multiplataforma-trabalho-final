package in

import (
	"context"
	"time"
)

// PaymentOutcome tells what RequestNextPayment did.
type PaymentOutcome string

const (
	// NoneDue: no invoice is waiting for its charge.
	NoneDue PaymentOutcome = "NONE_DUE"
	// Pending: the PSP accepted the charge and the result is on its way.
	Pending PaymentOutcome = "PENDING"
	// Refused: the PSP refused the charge, so the invoice failed.
	Refused PaymentOutcome = "REFUSED"
	// Postponed: the PSP could not be reached, so the invoice waits for a later attempt.
	Postponed PaymentOutcome = "POSTPONED"
)

// PaymentStatus is the result of a payment as the PSP reports it.
type PaymentStatus string

const (
	PaymentPaid   PaymentStatus = "PAID"
	PaymentFailed PaymentStatus = "FAILED"
)

// PaymentResult is the PSP reporting the payment of an invoice, by webhook or by query.
type PaymentResult struct {
	InvoiceID     string
	ChargeID      string
	Status        PaymentStatus
	FailureReason string
	// OccurredAt is when the PSP says it happened; zero means "now".
	OccurredAt time.Time
}

// RequestPaymentUseCase asks the PSP to charge the oldest invoice that is due.
type RequestPaymentUseCase interface {
	// RequestNextPayment returns Postponed with a nil error when the PSP is unavailable, and
	// with the error when the failure was unexpected; the retry is scheduled in both cases.
	RequestNextPayment(ctx context.Context) (PaymentOutcome, error)
}

// ApplyPaymentResultUseCase applies what the PSP reports. It fails with a NotFoundError for an
// unknown invoice and with a ConflictError for a result that contradicts the invoice.
type ApplyPaymentResultUseCase interface {
	// ApplyPaymentResult reports whether the invoice changed: a repeated result changes nothing.
	ApplyPaymentResult(ctx context.Context, result PaymentResult) (bool, error)
}

// ReconcilePaymentsUseCase asks the PSP about the charges that are still pending.
type ReconcilePaymentsUseCase interface {
	// ReconcilePendingPayments returns how many invoices it resolved.
	ReconcilePendingPayments(ctx context.Context) (int, error)
}
