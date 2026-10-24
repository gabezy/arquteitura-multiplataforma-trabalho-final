package invoice

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/port/in"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/port/out"
)

const (
	defaultReconcileAfter = 60 * time.Second
	defaultReconcileBatch = 50
	unspecifiedReason     = "UNSPECIFIED"
)

// PaymentOptions tunes the reconciliation; zero values take the defaults.
type PaymentOptions struct {
	// ReconcileAfter is how long a charge waits for its webhook before it is queried.
	ReconcileAfter time.Duration
	// ReconcileBatch is how many pending charges one reconciliation queries at most.
	ReconcileBatch int
}

// PaymentFacade implements the use cases of the payment of an invoice.
type PaymentFacade struct {
	invoices   out.PaymentInvoices
	transactor out.Transactor
	gateway    out.PaymentGateway
	clock      out.Clock
	options    PaymentOptions
}

func NewPaymentFacade(invoices out.PaymentInvoices, transactor out.Transactor, gateway out.PaymentGateway, clock out.Clock, options PaymentOptions) *PaymentFacade {
	if options.ReconcileAfter <= 0 {
		options.ReconcileAfter = defaultReconcileAfter
	}
	if options.ReconcileBatch <= 0 {
		options.ReconcileBatch = defaultReconcileBatch
	}
	return &PaymentFacade{invoices: invoices, transactor: transactor, gateway: gateway, clock: clock, options: options}
}

// RequestNextPayment charges the oldest invoice that is due. The row stays locked while
// the PSP answers, so a webhook for that invoice waits and no other worker takes it.
func (f *PaymentFacade) RequestNextPayment(ctx context.Context) (in.PaymentOutcome, error) {
	outcome := in.NoneDue
	var unexpected error

	err := f.transactor.WithinTransaction(ctx, func(ctx context.Context) error {
		invoice, err := f.invoices.LockNextDue(ctx, f.clock.Now())
		if isNotFound(err) {
			return nil
		}
		if err != nil {
			return err
		}

		snapshot := invoice.Snapshot()
		created, chargeErr := f.gateway.CreateCharge(ctx, out.ChargeRequest{
			InvoiceID:   snapshot.ID,
			Amount:      snapshot.Total,
			Description: fmt.Sprintf("Pedido %s (%s)", snapshot.OrderID, snapshot.Marketplace),
		})

		now := f.clock.Now()
		var refused *out.RefusedError
		switch {
		case chargeErr == nil:
			if err := invoice.MarkPaymentPending(created.ID, now); err != nil {
				return err
			}
			outcome = in.Pending
		case errors.As(chargeErr, &refused):
			if _, err := invoice.FailPayment("", refused.Code, now); err != nil {
				return err
			}
			outcome = in.Refused
		default:
			invoice.PaymentAttemptFailed(now)
			outcome = in.Postponed
			if !errors.Is(chargeErr, out.ErrUnavailable) {
				unexpected = chargeErr
			}
		}
		return f.invoices.Save(ctx, invoice)
	})
	if err != nil {
		return "", err
	}
	return outcome, unexpected
}

// ApplyPaymentResult applies what the PSP reports about an invoice.
func (f *PaymentFacade) ApplyPaymentResult(ctx context.Context, result in.PaymentResult) (bool, error) {
	changed := false
	err := f.transactor.WithinTransaction(ctx, func(ctx context.Context) error {
		invoice, err := f.invoices.LockByID(ctx, result.InvoiceID)
		if err != nil {
			return err
		}

		at := result.OccurredAt
		if at.IsZero() {
			at = f.clock.Now()
		}
		switch result.Status {
		case in.PaymentPaid:
			changed, err = invoice.ConfirmPayment(result.ChargeID, at)
		default:
			reason := strings.TrimSpace(result.FailureReason)
			if reason == "" {
				reason = unspecifiedReason
			}
			changed, err = invoice.FailPayment(result.ChargeID, reason, at)
		}
		if err != nil || !changed {
			return err
		}
		return f.invoices.Save(ctx, invoice)
	})
	if err != nil {
		return false, err
	}
	return changed, nil
}

// ReconcilePendingPayments queries the PSP about the charges that have been pending for
// longer than ReconcileAfter and applies the final ones, as the webhook would. It stops when
// the PSP is unavailable or ctx ends. A charge it cannot resolve (unknown to the PSP, or answered
// with something unusable) and a result that contradicts an invoice do not stop the others: the
// first such problem is returned after the whole batch.
func (f *PaymentFacade) ReconcilePendingPayments(ctx context.Context) (int, error) {
	cutoff := f.clock.Now().Add(-f.options.ReconcileAfter)
	pending, err := f.invoices.ListPendingRequestedBefore(ctx, cutoff, f.options.ReconcileBatch)
	if err != nil {
		return 0, err
	}

	resolved := 0
	var firstProblem error
	for _, invoice := range pending {
		status, err := f.gateway.GetCharge(ctx, invoice.PSPTransactionID)
		if err != nil {
			if errors.Is(err, out.ErrUnavailable) || ctx.Err() != nil {
				return resolved, err
			}
			if firstProblem == nil {
				firstProblem = fmt.Errorf("query charge %s of invoice %s: %w", invoice.PSPTransactionID, invoice.ID, err)
			}
			continue
		}

		result := in.PaymentResult{InvoiceID: invoice.ID, ChargeID: invoice.PSPTransactionID, FailureReason: status.FailureReason}
		switch status.State {
		case out.ChargePaid:
			result.Status = in.PaymentPaid
		case out.ChargeFailed:
			result.Status = in.PaymentFailed
		default:
			continue
		}

		changed, err := f.ApplyPaymentResult(ctx, result)
		if err != nil {
			if firstProblem == nil {
				firstProblem = fmt.Errorf("reconcile invoice %s: %w", invoice.ID, err)
			}
			continue
		}
		if changed {
			resolved++
		}
	}
	return resolved, firstProblem
}
