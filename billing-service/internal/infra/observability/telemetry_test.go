package observability_test

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/observability"
)

// fakeCollector records what the service sends to the OTLP/HTTP endpoints.
type fakeCollector struct {
	server *httptest.Server
	mu     sync.Mutex
	bodies map[string][]byte
}

func newFakeCollector(t *testing.T) *fakeCollector {
	t.Helper()
	c := &fakeCollector{bodies: map[string][]byte{}}
	c.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		c.mu.Lock()
		c.bodies[r.URL.Path] = append(c.bodies[r.URL.Path], body...)
		c.mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(c.server.Close)
	return c
}

func (c *fakeCollector) received(path string) []byte {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.bodies[path]
}

func setup(t *testing.T, collectorURL string, level slog.Level) (*observability.Telemetry, *bytes.Buffer) {
	t.Helper()
	var stdout bytes.Buffer
	tel, err := observability.Setup(context.Background(), observability.Options{
		ServiceName:  "billing-service",
		CollectorURL: collectorURL,
		LogLevel:     level,
		Stdout:       &stdout,
	})
	if err != nil {
		t.Fatalf("Setup() error = %v", err)
	}
	return tel, &stdout
}

func shutdown(t *testing.T, tel *observability.Telemetry) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := tel.Shutdown(ctx); err != nil {
		t.Fatalf("Shutdown() error = %v", err)
	}
}

// BOOT-05: traces, metrics and logs go over OTLP/HTTP to OTEL_COLLECTOR_URL with service.name billing-service.
func TestSetupExportsTracesMetricsAndLogsWithTheServiceName(t *testing.T) {
	collector := newFakeCollector(t)
	tel, _ := setup(t, collector.server.URL, slog.LevelInfo)
	ctx := context.Background()

	_, span := tel.TracerProvider.Tracer("test").Start(ctx, "unit-span")
	span.End()
	counter, err := tel.MeterProvider.Meter("test").Int64Counter("unit.counter")
	if err != nil {
		t.Fatal(err)
	}
	counter.Add(ctx, 1)
	tel.Logger.InfoContext(ctx, "unit-log-message")
	shutdown(t, tel)

	tests := []struct{ path, signal, name string }{
		{"/v1/traces", "trace", "unit-span"},
		{"/v1/metrics", "metric", "unit.counter"},
		{"/v1/logs", "log", "unit-log-message"},
	}
	for _, tt := range tests {
		body := collector.received(tt.path)
		if len(body) == 0 {
			t.Fatalf("the collector received no %s on %s", tt.signal, tt.path)
		}
		if !bytes.Contains(body, []byte("billing-service")) {
			t.Errorf("the %s export on %s does not carry service.name billing-service", tt.signal, tt.path)
		}
		if !bytes.Contains(body, []byte(tt.name)) {
			t.Errorf("the %s export on %s does not carry %q", tt.signal, tt.path, tt.name)
		}
	}
}

// LOG_LEVEL decides what reaches the console and what reaches the collector.
func TestLogLevelAppliesToTheConsoleAndTheCollector(t *testing.T) {
	collector := newFakeCollector(t)
	tel, stdout := setup(t, collector.server.URL, slog.LevelWarn)

	tel.Logger.Info("quiet-message")
	tel.Logger.Warn("loud-message")
	shutdown(t, tel)

	if !bytes.Contains(stdout.Bytes(), []byte("loud-message")) || bytes.Contains(stdout.Bytes(), []byte("quiet-message")) {
		t.Errorf("console output = %q, want only loud-message", stdout.String())
	}
	exported := collector.received("/v1/logs")
	if !bytes.Contains(exported, []byte("loud-message")) || bytes.Contains(exported, []byte("quiet-message")) {
		t.Errorf("collector received logs %q, want only loud-message", exported)
	}
}

// BOOT-06: a collector that is down never keeps the process from exiting.
func TestShutdownIsBoundedByItsContextWhenTheCollectorIsDown(t *testing.T) {
	tel, _ := setup(t, "http://127.0.0.1:1", slog.LevelInfo)
	_, span := tel.TracerProvider.Tracer("test").Start(context.Background(), "unsent-span")
	span.End()
	tel.Logger.Info("unsent-log")

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	started := time.Now()
	_ = tel.Shutdown(ctx)

	if elapsed := time.Since(started); elapsed > 3*time.Second {
		t.Fatalf("Shutdown() took %v with a 500ms context, want it bounded by the context", elapsed)
	}
}
