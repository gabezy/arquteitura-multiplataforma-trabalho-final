package worker

import (
	"context"
	"log/slog"
	"time"

	"go.opentelemetry.io/otel/attribute"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/port/in"
)

// PaymentWorker charges the invoices that are due at the PSP.
type PaymentWorker struct {
	payments in.RequestPaymentUseCase
	interval time.Duration
	logger   *slog.Logger
}

func NewPaymentWorker(payments in.RequestPaymentUseCase, interval time.Duration, logger *slog.Logger) *PaymentWorker {
	return &PaymentWorker{payments: payments, interval: interval, logger: logger}
}

// Run charges the due invoices every interval until ctx ends. It returns nil on cancellation.
func (w *PaymentWorker) Run(ctx context.Context) error {
	every(ctx, w.interval, w.RunOnce)
	return nil
}

// RunOnce charges the due invoices one by one, the oldest first, and stops when none is due, when the
// PSP is unavailable (the invoice that met it is postponed, and asking again now would only fail again),
// when something unexpected happens, or when ctx ends.
func (w *PaymentWorker) RunOnce(ctx context.Context) {
	for ctx.Err() == nil {
		outcome, err := w.requestNext(ctx)
		if err != nil {
			if ctx.Err() == nil {
				w.logger.ErrorContext(ctx, "requesting a payment failed", "error", err.Error())
			}
			return
		}
		switch outcome {
		case in.NoneDue:
			return
		case in.Postponed:
			w.logger.WarnContext(ctx, "payment provider unavailable: the invoice will be charged later")
			return
		}
	}
}

func (w *PaymentWorker) requestNext(ctx context.Context) (in.PaymentOutcome, error) {
	ctx, span := startSpan(ctx, "payment.request")
	defer span.End()

	outcome, err := w.payments.RequestNextPayment(ctx)
	span.SetAttributes(attribute.String("payment.outcome", string(outcome)))
	if err != nil {
		recordError(span, err)
	}
	return outcome, err
}
