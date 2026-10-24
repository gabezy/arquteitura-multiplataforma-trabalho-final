package app_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/twmb/franz-go/pkg/kfake"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/app"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/config"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/persistence"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/testsupport"
)

func TestMain(m *testing.M) {
	code := m.Run()
	testsupport.Terminate()
	os.Exit(code)
}

func freePort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port
}

func newKafka(t *testing.T) []string {
	t.Helper()
	cluster, err := kfake.NewCluster(kfake.NumBrokers(1))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(cluster.Close)
	return cluster.ListenAddrs()
}

// testConfig loads the configuration the way the service does, so the tests run with the real defaults.
func testConfig(t *testing.T, databaseURL string, brokers []string) config.Config {
	t.Helper()
	values := map[string]string{
		"PORT":                 strconv.Itoa(freePort(t)),
		"DATABASE_URL":         databaseURL,
		"KAFKA_BROKERS":        strings.Join(brokers, ","),
		"OTEL_COLLECTOR_URL":   "http://127.0.0.1:1",
		"OUTBOX_POLL_INTERVAL": "50ms",
	}
	cfg, err := config.Load(func(key string) (string, bool) {
		value, ok := values[key]
		return value, ok
	})
	if err != nil {
		t.Fatal(err)
	}
	return cfg
}

func quietLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// start runs the service and returns its stop function and the channel of its result.
func start(t *testing.T, cfg config.Config) (context.CancelFunc, <-chan error) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- app.Run(ctx, cfg, quietLogger()) }()
	t.Cleanup(func() {
		cancel()
		select {
		case <-done:
		case <-time.After(app.ShutdownTimeout + 2*time.Second):
		}
	})
	return cancel, done
}

func waitUntilHealthy(t *testing.T, port int, done <-chan error) {
	t.Helper()
	url := "http://127.0.0.1:" + strconv.Itoa(port) + "/health"
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		select {
		case err := <-done:
			t.Fatalf("the service stopped before it became healthy: %v", err)
		default:
		}
		if response, err := http.Get(url); err == nil {
			response.Body.Close()
			if response.StatusCode == http.StatusOK {
				return
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("the service did not answer 200 on %s within 30s", url)
}

// BOOT-01 and BOOT-03: by the time the service answers, the migrations are applied.
func TestRunAnswersHealthOnlyAfterTheMigrationsAreApplied(t *testing.T) {
	databaseURL := testsupport.NewDatabase(t)
	cfg := testConfig(t, databaseURL, newKafka(t))
	_, done := start(t, cfg)

	waitUntilHealthy(t, cfg.Port, done)

	db, err := persistence.Open(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var migrated bool
	err = db.Querier(context.Background()).QueryRow(context.Background(),
		`SELECT to_regclass('public.outbox') IS NOT NULL AND to_regclass('public.processed_events') IS NOT NULL`).Scan(&migrated)
	if err != nil || !migrated {
		t.Fatalf("outbox and processed_events exist = %v (err %v), want true as soon as /health answers", migrated, err)
	}
}

// BOOT-03: nothing listens while the migrations cannot run.
func TestRunDoesNotListenWhenTheMigrationsFail(t *testing.T) {
	cfg := testConfig(t, "postgresql://billing:pw-2d5f@127.0.0.1:1/billing", newKafka(t))

	err := app.Run(context.Background(), cfg, quietLogger())

	if err == nil {
		t.Fatal("Run() error = nil, want the migration failure")
	}
	if connection, dialErr := net.DialTimeout("tcp", "127.0.0.1:"+strconv.Itoa(cfg.Port), time.Second); dialErr == nil {
		connection.Close()
		t.Fatalf("port %d accepts connections although the migrations failed", cfg.Port)
	}
}

// BOOT-06: after the cancellation, Run returns cleanly within 10 s, and the port is released.
func TestRunStopsCleanlyWithinTenSecondsOfTheCancellation(t *testing.T) {
	cfg := testConfig(t, testsupport.NewDatabase(t), newKafka(t))
	cancel, done := start(t, cfg)
	waitUntilHealthy(t, cfg.Port, done)

	started := time.Now()
	cancel()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Run() error = %v, want nil after a clean shutdown", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("Run did not return within 10s of the cancellation")
	}
	if elapsed := time.Since(started); elapsed > 10*time.Second {
		t.Fatalf("shutdown took %v, want at most 10s", elapsed)
	}

	if connection, err := net.DialTimeout("tcp", "127.0.0.1:"+strconv.Itoa(cfg.Port), time.Second); err == nil {
		connection.Close()
		t.Fatal("the port still accepts connections after the shutdown")
	}
}

func TestRunReportsAPortThatIsAlreadyInUse(t *testing.T) {
	listener, err := net.Listen("tcp", ":0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	cfg := testConfig(t, testsupport.NewDatabase(t), newKafka(t))
	cfg.Port = listener.Addr().(*net.TCPAddr).Port

	done := make(chan error, 1)
	go func() { done <- app.Run(context.Background(), cfg, quietLogger()) }()

	select {
	case err := <-done:
		if err == nil || errors.Is(err, context.Canceled) {
			t.Fatalf("Run() error = %v, want the listen failure", err)
		}
	case <-time.After(30 * time.Second):
		t.Fatal("Run kept going although it could not listen")
	}
}
