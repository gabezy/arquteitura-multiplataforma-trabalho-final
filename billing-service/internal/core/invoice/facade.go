// Package invoice is the application layer of the invoice: the facade implements
// the driving ports and depends only on the driven ports.
package invoice

import (
	"context"
	"errors"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/model"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/port/in"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/port/out"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/shared/domain"
)

// Facade implements the use cases of the invoice.
type Facade struct {
	invoices      out.InvoiceRepository
	cancellations out.OrderCancellations
	transactor    out.Transactor
	ids           out.IDGenerator
	clock         out.Clock
	policies      out.CommissionPolicies
}

func NewFacade(
	invoices out.InvoiceRepository,
	cancellations out.OrderCancellations,
	transactor out.Transactor,
	ids out.IDGenerator,
	clock out.Clock,
	policies out.CommissionPolicies,
) *Facade {
	return &Facade{
		invoices:      invoices,
		cancellations: cancellations,
		transactor:    transactor,
		ids:           ids,
		clock:         clock,
		policies:      policies,
	}
}

// IssueInvoice creates the invoice of a confirmed order, once. An order that
// already has an invoice keeps it, and an order cancelled before its
// confirmation arrived gets none.
func (f *Facade) IssueInvoice(ctx context.Context, order model.OrderData) (in.IssueOutcome, error) {
	var outcome in.IssueOutcome
	err := f.transactor.WithinTransaction(ctx, func(ctx context.Context) error {
		_, err := f.invoices.FindByOrderID(ctx, order.OrderID)
		if err == nil {
			outcome = in.AlreadyIssued
			return nil
		}
		if !isNotFound(err) {
			return err
		}

		cancelled, err := f.cancellations.IsCancelled(ctx, order.OrderID)
		if err != nil {
			return err
		}
		if cancelled {
			outcome = in.OrderCancelled
			return nil
		}

		policy, err := f.policies.For(order.Marketplace)
		if err != nil {
			return err
		}
		invoice, err := model.IssueInvoice(f.ids.NewID(), order, policy, f.clock.Now())
		if err != nil {
			return err
		}
		if err := f.invoices.Save(ctx, invoice); err != nil {
			return err
		}
		outcome = in.Issued
		return nil
	})
	if err != nil {
		return "", err
	}
	return outcome, nil
}

// CancelInvoice cancels the invoice of a cancelled order while it can still be
// cancelled. With no invoice yet it records the cancellation, so that the
// confirmation that arrives later creates none.
func (f *Facade) CancelInvoice(ctx context.Context, command in.CancelInvoiceCommand) (in.CancelOutcome, error) {
	var outcome in.CancelOutcome
	err := f.transactor.WithinTransaction(ctx, func(ctx context.Context) error {
		now := f.clock.Now()

		invoice, err := f.invoices.FindByOrderID(ctx, command.OrderID)
		if isNotFound(err) {
			if err := f.cancellations.Record(ctx, command.OrderID, command.Reason, now); err != nil {
				return err
			}
			outcome = in.Recorded
			return nil
		}
		if err != nil {
			return err
		}

		if !invoice.Cancel(command.Reason, now) {
			outcome = in.Unchanged
			return nil
		}
		if err := f.invoices.Save(ctx, invoice); err != nil {
			return err
		}
		outcome = in.Cancelled
		return nil
	})
	if err != nil {
		return "", err
	}
	return outcome, nil
}

// GetInvoice reads one invoice.
func (f *Facade) GetInvoice(ctx context.Context, id string) (model.Snapshot, error) {
	invoice, err := f.invoices.FindByID(ctx, id)
	if err != nil {
		return model.Snapshot{}, err
	}
	return invoice.Snapshot(), nil
}

// ListInvoices lists invoices, newest first.
func (f *Facade) ListInvoices(ctx context.Context, query model.InvoiceQuery) ([]model.Snapshot, error) {
	return f.invoices.List(ctx, query)
}

func isNotFound(err error) bool {
	var notFound *domain.NotFoundError
	return errors.As(err, &notFound)
}
