// Package worker runs the background loops of the payment: the one that charges the invoices that
// are due and the one that asks the PSP about the charges whose webhook never came.
package worker

import (
	"context"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

const tracerName = "billing-service/worker"

// every runs round once per interval, the first time one interval after the start, until ctx ends.
func every(ctx context.Context, interval time.Duration, round func(ctx context.Context)) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			round(ctx)
		}
	}
}

// startSpan opens the span that groups what one step does, so that its queries and its call to the
// PSP show up in one trace.
func startSpan(ctx context.Context, name string) (context.Context, trace.Span) {
	return otel.Tracer(tracerName).Start(ctx, name)
}

func recordError(span trace.Span, err error) {
	span.RecordError(err)
	span.SetStatus(codes.Error, err.Error())
}
