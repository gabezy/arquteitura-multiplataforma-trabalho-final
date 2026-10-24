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

const (
	validDatabaseURL  = "postgresql://billing:s3cr3t-pw@localhost:5435/billing"
	validWebhookToken = "psp-demo-token"
)

// requiredEnv is the minimum a valid environment has, plus what the test sets on top of it.
func requiredEnv(extra map[string]string) map[string]string {
	values := map[string]string{"DATABASE_URL": validDatabaseURL, "PSP_WEBHOOK_TOKEN": validWebhookToken}
	for key, value := range extra {
		values[key] = value
	}
	return values
}

func lookupFrom(values map[string]string) config.Lookup {
	return func(key string) (string, bool) {
		value, ok := values[key]
		return value, ok
	}
}

func TestLoadAppliesTheDocumentedDefaults(t *testing.T) {
	cfg, err := config.Load(lookupFrom(requiredEnv(nil)))
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
		ConsumerGroup:      "billing-service",
		ConfirmedTopic:     "order.order.confirmed.v1",
		CancelledTopic:     "order.order.cancelled.v1",
		DeadLetterTopic:    "billing.order-events.dlq",
		CommissionBps:      map[string]int{"AMAZON": 1200, "MERCADO_LIVRE": 1100, "SHOPEE": 1400},

		PSPBaseURL:          "http://localhost:8089",
		PSPCallbackURL:      "http://host.docker.internal:8086/webhooks/psp",
		PSPWebhookToken:     validWebhookToken,
		PaymentPollInterval: 2 * time.Second,
		ReconcileInterval:   30 * time.Second,
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

		"KAFKA_CONSUMER_GROUP":             "billing-test",
		"ORDER_CONFIRMED_TOPIC":            "orders.confirmed",
		"ORDER_CANCELLED_TOPIC":            "orders.cancelled",
		"ORDER_EVENTS_DLQ_TOPIC":           "billing.dlq",
		"COMMISSION_AMAZON_PERCENT":        "10",
		"COMMISSION_MERCADO_LIVRE_PERCENT": "9.5",
		"COMMISSION_SHOPEE_PERCENT":        "0",

		"PSP_BASE_URL":          "http://psp.example:8080",
		"PSP_CALLBACK_URL":      "https://billing.example/webhooks/psp",
		"PSP_WEBHOOK_TOKEN":     "another-token",
		"PAYMENT_POLL_INTERVAL": "500ms",
		"RECONCILE_INTERVAL":    "5s",
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
		ConsumerGroup:      "billing-test",
		ConfirmedTopic:     "orders.confirmed",
		CancelledTopic:     "orders.cancelled",
		DeadLetterTopic:    "billing.dlq",
		CommissionBps:      map[string]int{"AMAZON": 1000, "MERCADO_LIVRE": 950, "SHOPEE": 0},

		PSPBaseURL:          "http://psp.example:8080",
		PSPCallbackURL:      "https://billing.example/webhooks/psp",
		PSPWebhookToken:     "another-token",
		PaymentPollInterval: 500 * time.Millisecond,
		ReconcileInterval:   5 * time.Second,
	}
	if !reflect.DeepEqual(cfg, want) {
		t.Fatalf("Load() = %+v, want %+v", cfg, want)
	}
}

func TestLoadTreatsABlankVariableAsUnset(t *testing.T) {
	cfg, err := config.Load(lookupFrom(requiredEnv(map[string]string{"PORT": "  "})))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Port != 8086 {
		t.Fatalf("Port = %d, want the default 8086", cfg.Port)
	}
}

func TestLoadPointsTheDefaultCallbackAtTheConfiguredPort(t *testing.T) {
	cfg, err := config.Load(lookupFrom(requiredEnv(map[string]string{"PORT": "9000"})))
	if err != nil {
		t.Fatal(err)
	}
	if want := "http://host.docker.internal:9000/webhooks/psp"; cfg.PSPCallbackURL != want {
		t.Fatalf("PSPCallbackURL = %q, want %q", cfg.PSPCallbackURL, want)
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
		{"KAFKA_CONSUMER_GROUP", "bad group 7e1d"},
		{"ORDER_CONFIRMED_TOPIC", "topic with spaces 3a9c"},
		{"ORDER_CANCELLED_TOPIC", "not/a/topic-5b2f"},
		{"ORDER_EVENTS_DLQ_TOPIC", "dlq?-8d4e"},
		{"COMMISSION_AMAZON_PERCENT", "abc-1f6a"},
		{"COMMISSION_AMAZON_PERCENT", "100.01"},
		{"COMMISSION_MERCADO_LIVRE_PERCENT", "-1"},
		{"COMMISSION_SHOPEE_PERCENT", "12.345"},
		{"COMMISSION_SHOPEE_PERCENT", "1e1"},
		{"PSP_BASE_URL", "ftp://psp-2c7e:8080"},
		{"PSP_BASE_URL", "::not a url 6d1b"},
		{"PSP_CALLBACK_URL", "billing-9a3e/webhooks"},
		{"PAYMENT_POLL_INTERVAL", "soon-4b8d"},
		{"PAYMENT_POLL_INTERVAL", "0s"},
		{"RECONCILE_INTERVAL", "-5s"},
	}
	for _, tt := range tests {
		t.Run(tt.variable+"="+tt.value, func(t *testing.T) {
			values := requiredEnv(map[string]string{tt.variable: tt.value})

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

// PAY-06: without the secret the webhook could not tell the PSP from anyone else, so the service does not start.
func TestLoadRequiresThePSPWebhookToken(t *testing.T) {
	for name, values := range map[string]map[string]string{
		"unset": {"DATABASE_URL": validDatabaseURL},
		"blank": {"DATABASE_URL": validDatabaseURL, "PSP_WEBHOOK_TOKEN": "   "},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := config.Load(lookupFrom(values))

			var invalid *config.InvalidError
			if !errors.As(err, &invalid) || len(invalid.Problems) != 1 || invalid.Problems[0].Variable != "PSP_WEBHOOK_TOKEN" {
				t.Fatalf("Load() error = %v, want one problem naming PSP_WEBHOOK_TOKEN", err)
			}
		})
	}
}

func TestLoadReportsEveryInvalidVariableTogether(t *testing.T) {
	_, err := config.Load(lookupFrom(requiredEnv(map[string]string{
		"PORT":      "abc",
		"LOG_LEVEL": "loud",
	})))

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
