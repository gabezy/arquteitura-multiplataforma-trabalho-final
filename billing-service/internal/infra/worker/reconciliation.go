package worker

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"go.opentelemetry.io/otel/attribute"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/port/in"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/port/out"
)

// ReconciliationWorker asks the PSP about the charges whose webhook did not arrive.
type ReconciliationWorker struct {
	reconciler in.ReconcilePaymentsUseCase
	interval   time.Duration
	logger     *slog.Logger
}

func NewReconciliationWorker(reconciler in.ReconcilePaymentsUseCase, interval time.Duration, logger *slog.Logger) *ReconciliationWorker {
	return &ReconciliationWorker{reconciler: reconciler, interval: interval, logger: logger}
}

// Run reconciles every interval until ctx ends. It returns nil on cancellation.
func (w *ReconciliationWorker) Run(ctx context.Context) error {
	every(ctx, w.interval, w.RunOnce)
	return nil
}

// RunOnce reconciles the pending charges one time. A PSP that is unavailable is a warning, because
// the next round tries again; anything else is an error.
func (w *ReconciliationWorker) RunOnce(ctx context.Context) {
	ctx, span := startSpan(ctx, "payment.reconcile")
	defer span.End()

	resolved, err := w.reconciler.ReconcilePendingPayments(ctx)
	span.SetAttributes(attribute.Int("payment.resolved", resolved))
	switch {
	case err != nil && ctx.Err() != nil:
		// The service is stopping.
	case errors.Is(err, out.ErrUnavailable):
		w.logger.WarnContext(ctx, "payment provider unavailable: pending payments will be reconciled later", "resolved", resolved, "error", err.Error())
	case err != nil:
		recordError(span, err)
		w.logger.ErrorContext(ctx, "reconciling pending payments failed", "resolved", resolved, "error", err.Error())
	case resolved > 0:
		w.logger.InfoContext(ctx, "pending payments reconciled", "resolved", resolved)
	}
}
