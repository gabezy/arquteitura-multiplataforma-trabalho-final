// Package in holds the driving ports of the invoice: what the outside world asks of the core.
package in

import (
	"context"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/model"
)

// IssueOutcome tells what IssueInvoice did.
type IssueOutcome string

const (
	// Issued: a new invoice was created.
	Issued IssueOutcome = "ISSUED"
	// AlreadyIssued: the order already has its invoice, which was kept.
	AlreadyIssued IssueOutcome = "ALREADY_ISSUED"
	// OrderCancelled: the order was cancelled before its confirmation arrived, so no invoice was created.
	OrderCancelled IssueOutcome = "ORDER_CANCELLED"
)

// CancelOutcome tells what CancelInvoice did.
type CancelOutcome string

const (
	// Cancelled: the invoice was cancelled.
	Cancelled CancelOutcome = "CANCELLED"
	// KeptPaid: the invoice is paid, so it stays paid: there is no refund, and the caller should say so.
	KeptPaid CancelOutcome = "KEPT_PAID"
	// Unchanged: the invoice has failed or was already cancelled and kept its state.
	Unchanged CancelOutcome = "UNCHANGED"
	// Recorded: there is no invoice yet, so the cancellation of the order was recorded.
	Recorded CancelOutcome = "RECORDED"
)

type CancelInvoiceCommand struct {
	OrderID string
	Reason  string
}

// IssueInvoiceUseCase creates the invoice of a confirmed order, once.
type IssueInvoiceUseCase interface {
	IssueInvoice(ctx context.Context, order model.OrderData) (IssueOutcome, error)
}

// CancelInvoiceUseCase reacts to the cancellation of an order.
type CancelInvoiceUseCase interface {
	CancelInvoice(ctx context.Context, command CancelInvoiceCommand) (CancelOutcome, error)
}

// GetInvoiceUseCase reads one invoice. It fails with a NotFoundError for an unknown id.
type GetInvoiceUseCase interface {
	GetInvoice(ctx context.Context, id string) (model.Snapshot, error)
}

// ListInvoicesUseCase lists invoices, newest first.
type ListInvoicesUseCase interface {
	ListInvoices(ctx context.Context, query model.InvoiceQuery) ([]model.Snapshot, error)
}
