package out

import (
	"context"
	"errors"
	"time"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/model"
)

// PaymentInvoices is what the payment needs from the invoice store, on top of InvoiceRepository.
type PaymentInvoices interface {
	InvoiceRepository
	// LockNextDue returns the oldest issued invoice whose charge is due, and keeps its row locked
	// until the transaction ends, skipping rows another transaction holds. It fails with a
	// NotFoundError when none is due.
	LockNextDue(ctx context.Context, now time.Time) (*model.Invoice, error)
	// LockByID is FindByID that keeps the row locked until the transaction ends.
	LockByID(ctx context.Context, id string) (*model.Invoice, error)
	// ListPendingRequestedBefore lists the invoices waiting for the PSP since before the cutoff, oldest first.
	ListPendingRequestedBefore(ctx context.Context, cutoff time.Time, limit int) ([]model.Snapshot, error)
}

// ChargeRequest asks the PSP to charge an invoice. The invoice id is also the idempotency key.
type ChargeRequest struct {
	InvoiceID   string
	Amount      model.Money
	Description string
}

// ChargeCreated is the PSP accepting the charge: the result comes later, by webhook or by query.
type ChargeCreated struct {
	ID string
}

// ChargeState is where a charge is at the PSP.
type ChargeState string

const (
	ChargePending ChargeState = "PENDING"
	ChargePaid    ChargeState = "PAID"
	ChargeFailed  ChargeState = "FAILED"
)

type ChargeStatus struct {
	State         ChargeState
	FailureReason string
}

// PaymentGateway is the PSP. A charge the PSP refuses to create fails with a *RefusedError,
// a PSP that cannot be reached (timeout, 5xx, open circuit) with an error that wraps ErrUnavailable,
// and a query about a charge it does not know with an error that wraps ErrChargeNotFound.
type PaymentGateway interface {
	CreateCharge(ctx context.Context, request ChargeRequest) (ChargeCreated, error)
	GetCharge(ctx context.Context, chargeID string) (ChargeStatus, error)
}

// RefusedError is the PSP refusing to create a charge, with its reason code.
type RefusedError struct {
	Code string
}

func (e *RefusedError) Error() string { return "payment refused: " + e.Code }

// ErrUnavailable marks a PSP that could not be reached, so the same call may work later.
var ErrUnavailable = errors.New("payment provider unavailable")

// ErrChargeNotFound marks a charge the PSP does not know.
var ErrChargeNotFound = errors.New("charge unknown to the payment provider")
