// Package observability sets up OpenTelemetry traces, metrics and logs over OTLP/HTTP.
package observability

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"time"

	"go.opentelemetry.io/contrib/bridges/otelslog"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/propagation"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

const metricsInterval = 60 * time.Second

// Options configures Setup.
type Options struct {
	ServiceName  string
	CollectorURL string
	LogLevel     slog.Level
	// Stdout receives the JSON console logs.
	Stdout io.Writer
}

// Telemetry holds the providers and the logger Setup built.
type Telemetry struct {
	Logger         *slog.Logger
	TracerProvider trace.TracerProvider
	MeterProvider  metric.MeterProvider

	tracerProvider *sdktrace.TracerProvider
	meterProvider  *sdkmetric.MeterProvider
	loggerProvider *sdklog.LoggerProvider
}

// Setup starts the exporters and makes the providers and the propagator global.
// The exporters connect lazily, so a collector that is down does not stop the
// service from starting.
func Setup(ctx context.Context, opts Options) (*Telemetry, error) {
	res, err := resource.Merge(resource.Default(), resource.NewSchemaless(attribute.String("service.name", opts.ServiceName)))
	if err != nil {
		return nil, fmt.Errorf("build telemetry resource: %w", err)
	}
	base := strings.TrimRight(opts.CollectorURL, "/")

	traceExporter, err := otlptracehttp.New(ctx, otlptracehttp.WithEndpointURL(base+"/v1/traces"))
	if err != nil {
		return nil, fmt.Errorf("create trace exporter: %w", err)
	}
	metricExporter, err := otlpmetrichttp.New(ctx, otlpmetrichttp.WithEndpointURL(base+"/v1/metrics"))
	if err != nil {
		return nil, fmt.Errorf("create metric exporter: %w", err)
	}
	logExporter, err := otlploghttp.New(ctx, otlploghttp.WithEndpointURL(base+"/v1/logs"))
	if err != nil {
		return nil, fmt.Errorf("create log exporter: %w", err)
	}

	tracerProvider := sdktrace.NewTracerProvider(sdktrace.WithResource(res), sdktrace.WithBatcher(traceExporter))
	meterProvider := sdkmetric.NewMeterProvider(
		sdkmetric.WithResource(res),
		sdkmetric.WithReader(sdkmetric.NewPeriodicReader(metricExporter, sdkmetric.WithInterval(metricsInterval))),
	)
	loggerProvider := sdklog.NewLoggerProvider(sdklog.WithResource(res), sdklog.WithProcessor(sdklog.NewBatchProcessor(logExporter)))

	otel.SetTracerProvider(tracerProvider)
	otel.SetMeterProvider(meterProvider)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))

	console := slog.NewJSONHandler(opts.Stdout, &slog.HandlerOptions{Level: opts.LogLevel})
	collector := levelFilter{level: opts.LogLevel, next: otelslog.NewHandler(opts.ServiceName, otelslog.WithLoggerProvider(loggerProvider))}

	// Export failures go to the console only: sending them to the collector would feed itself.
	consoleOnly := slog.New(console)
	otel.SetErrorHandler(otel.ErrorHandlerFunc(func(err error) {
		consoleOnly.Warn("telemetry export failed", "error", err.Error())
	}))

	return &Telemetry{
		Logger:         slog.New(slog.NewMultiHandler(console, collector)),
		TracerProvider: tracerProvider,
		MeterProvider:  meterProvider,
		tracerProvider: tracerProvider,
		meterProvider:  meterProvider,
		loggerProvider: loggerProvider,
	}, nil
}

// Shutdown flushes what is pending and stops the exporters, within ctx.
func (t *Telemetry) Shutdown(ctx context.Context) error {
	return errors.Join(
		t.tracerProvider.Shutdown(ctx),
		t.meterProvider.Shutdown(ctx),
		t.loggerProvider.Shutdown(ctx),
	)
}

// levelFilter applies LOG_LEVEL to the OTLP handler, which would otherwise export every level.
type levelFilter struct {
	level slog.Leveler
	next  slog.Handler
}

func (h levelFilter) Enabled(ctx context.Context, level slog.Level) bool {
	return level >= h.level.Level() && h.next.Enabled(ctx, level)
}

func (h levelFilter) Handle(ctx context.Context, record slog.Record) error {
	return h.next.Handle(ctx, record)
}

func (h levelFilter) WithAttrs(attrs []slog.Attr) slog.Handler {
	return levelFilter{level: h.level, next: h.next.WithAttrs(attrs)}
}

func (h levelFilter) WithGroup(name string) slog.Handler {
	return levelFilter{level: h.level, next: h.next.WithGroup(name)}
}
