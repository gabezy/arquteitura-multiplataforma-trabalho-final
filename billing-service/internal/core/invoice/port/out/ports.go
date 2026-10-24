// Package out holds the driven ports of the invoice: what the core needs from the outside world.
package out

import (
	"context"
	"time"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/model"
)

// InvoiceRepository stores invoices.
type InvoiceRepository interface {
	// Save inserts a new invoice or updates an existing one with optimistic
	// locking, and appends the events the invoice recorded to the outbox in the
	// same transaction. A second invoice for the same order fails with a ConflictError.
	Save(ctx context.Context, invoice *model.Invoice) error
	// FindByID fails with a NotFoundError when there is no such invoice.
	FindByID(ctx context.Context, id string) (*model.Invoice, error)
	// FindByOrderID fails with a NotFoundError when the order has no invoice.
	FindByOrderID(ctx context.Context, orderID string) (*model.Invoice, error)
	// List returns the invoices that match the query, newest first.
	List(ctx context.Context, query model.InvoiceQuery) ([]model.Snapshot, error)
}

// OrderCancellations remembers the orders that were cancelled before their invoice existed.
type OrderCancellations interface {
	// Record is idempotent: recording an order twice changes nothing.
	Record(ctx context.Context, orderID, reason string, at time.Time) error
	IsCancelled(ctx context.Context, orderID string) (bool, error)
}

// Transactor runs a function in one transaction. A call made inside another one joins it.
type Transactor interface {
	WithinTransaction(ctx context.Context, fn func(ctx context.Context) error) error
}

// IDGenerator creates the id of a new invoice.
type IDGenerator interface {
	NewID() string
}

// Clock tells the time.
type Clock interface {
	Now() time.Time
}

// CommissionPolicies picks the commission policy of a marketplace.
type CommissionPolicies interface {
	For(marketplace model.Marketplace) (model.CommissionPolicy, error)
}
