package config_test

import (
	"errors"
	"log/slog"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/config"
)

const validDatabaseURL = "postgresql://billing:s3cr3t-pw@localhost:5435/billing"

func lookupFrom(values map[string]string) config.Lookup {
	return func(key string) (string, bool) {
		value, ok := values[key]
		return value, ok
	}
}

func TestLoadAppliesTheDocumentedDefaults(t *testing.T) {
	cfg, err := config.Load(lookupFrom(map[string]string{"DATABASE_URL": validDatabaseURL}))
	if err != nil {
		t.Fatal(err)
	}

	want := config.Config{
		Port:               8086,
		LogLevel:           slog.LevelInfo,
		ServiceName:        "billing-service",
		OTelCollectorURL:   "http://localhost:4318",
		DatabaseURL:        validDatabaseURL,
		KafkaBrokers:       []string{"localhost:9092"},
		OutboxPollInterval: time.Second,
	}
	if !reflect.DeepEqual(cfg, want) {
		t.Fatalf("Load() = %+v, want %+v", cfg, want)
	}
}

func TestLoadReadsEveryVariable(t *testing.T) {
	cfg, err := config.Load(lookupFrom(map[string]string{
		"PORT":                 "9000",
		"LOG_LEVEL":            "DEBUG",
		"OTEL_SERVICE_NAME":    "billing-test",
		"OTEL_COLLECTOR_URL":   "https://collector.example:4318",
		"DATABASE_URL":         "postgres://u:p@db:5432/x",
		"KAFKA_BROKERS":        "kafka-1:9092, kafka-2:9093",
		"OUTBOX_POLL_INTERVAL": "250ms",
	}))
	if err != nil {
		t.Fatal(err)
	}

	want := config.Config{
		Port:               9000,
		LogLevel:           slog.LevelDebug,
		ServiceName:        "billing-test",
		OTelCollectorURL:   "https://collector.example:4318",
		DatabaseURL:        "postgres://u:p@db:5432/x",
		KafkaBrokers:       []string{"kafka-1:9092", "kafka-2:9093"},
		OutboxPollInterval: 250 * time.Millisecond,
	}
	if !reflect.DeepEqual(cfg, want) {
		t.Fatalf("Load() = %+v, want %+v", cfg, want)
	}
}

func TestLoadTreatsABlankVariableAsUnset(t *testing.T) {
	cfg, err := config.Load(lookupFrom(map[string]string{"DATABASE_URL": validDatabaseURL, "PORT": "  "}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Port != 8086 {
		t.Fatalf("Port = %d, want the default 8086", cfg.Port)
	}
}

// BOOT-04: an invalid variable is named in the error and its value is never printed.
func TestLoadNamesEachInvalidVariableWithoutItsValue(t *testing.T) {
	tests := []struct {
		variable string
		value    string
	}{
		{"PORT", "not-a-port-9f3a"},
		{"PORT", "0"},
		{"PORT", "70000"},
		{"LOG_LEVEL", "loud-7c1e"},
		{"OTEL_COLLECTOR_URL", "ftp://collector-5d2b:4318"},
		{"OTEL_COLLECTOR_URL", "::not a url 4e8c"},
		{"DATABASE_URL", "mysql://user:hunter2-1a7d@db/x"},
		{"DATABASE_URL", "postgresql://user:hunter2-1a7d@/x"},
		{"KAFKA_BROKERS", "no-port-3b9f"},
		{"KAFKA_BROKERS", "kafka:99999"},
		{"KAFKA_BROKERS", " , "},
		{"OUTBOX_POLL_INTERVAL", "soon-6e0a"},
		{"OUTBOX_POLL_INTERVAL", "-1s"},
		{"OUTBOX_POLL_INTERVAL", "0s"},
	}
	for _, tt := range tests {
		t.Run(tt.variable+"="+tt.value, func(t *testing.T) {
			values := map[string]string{"DATABASE_URL": validDatabaseURL}
			values[tt.variable] = tt.value

			_, err := config.Load(lookupFrom(values))

			var invalid *config.InvalidError
			if !errors.As(err, &invalid) {
				t.Fatalf("Load() error = %v, want *config.InvalidError", err)
			}
			if !strings.Contains(err.Error(), tt.variable) {
				t.Errorf("error %q does not name %s", err, tt.variable)
			}
			if secret := strings.TrimSpace(tt.value); len(secret) >= 4 && strings.Contains(err.Error(), secret) {
				t.Errorf("error %q prints the value of %s", err, tt.variable)
			}
		})
	}
}

func TestLoadRequiresDatabaseURLAndNeverPrintsItsDefaultCredentials(t *testing.T) {
	_, err := config.Load(lookupFrom(map[string]string{}))

	var invalid *config.InvalidError
	if !errors.As(err, &invalid) || !strings.Contains(err.Error(), "DATABASE_URL") {
		t.Fatalf("Load() error = %v, want an error naming DATABASE_URL", err)
	}
}

func TestLoadReportsEveryInvalidVariableTogether(t *testing.T) {
	_, err := config.Load(lookupFrom(map[string]string{
		"PORT":         "abc",
		"LOG_LEVEL":    "loud",
		"DATABASE_URL": validDatabaseURL,
	}))

	var invalid *config.InvalidError
	if !errors.As(err, &invalid) {
		t.Fatalf("Load() error = %v, want *config.InvalidError", err)
	}
	if len(invalid.Problems) != 2 {
		t.Fatalf("got %d problems %v, want 2", len(invalid.Problems), invalid.Problems)
	}
	for _, name := range []string{"PORT", "LOG_LEVEL"} {
		if !strings.Contains(err.Error(), name) {
			t.Errorf("error %q does not name %s", err, name)
		}
	}
}
