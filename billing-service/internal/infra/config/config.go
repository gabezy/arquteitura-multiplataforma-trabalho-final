// Package config reads the service configuration from environment variables.
package config

import (
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/model"
)

const (
	defaultPort               = 8086
	defaultServiceName        = "billing-service"
	defaultOTelCollectorURL   = "http://localhost:4318"
	defaultKafkaBrokers       = "localhost:9092"
	defaultOutboxPollInterval = time.Second
	defaultPSPBaseURL         = "http://localhost:8089"
	defaultPaymentInterval    = 2 * time.Second
	defaultReconcileInterval  = 30 * time.Second
	defaultReconcileAfter     = 60 * time.Second
	maxPort                   = 65535
	maxPercentBps             = 10000
)

// Config is the validated configuration of the service.
type Config struct {
	Port               int
	LogLevel           slog.Level
	ServiceName        string
	OTelCollectorURL   string
	DatabaseURL        string
	KafkaBrokers       []string
	OutboxPollInterval time.Duration
	// ConsumerGroup, ConfirmedTopic, CancelledTopic and DeadLetterTopic are the Kafka names of the order consumer.
	ConsumerGroup   string
	ConfirmedTopic  string
	CancelledTopic  string
	DeadLetterTopic string
	// CommissionBps is the commission of each marketplace, in basis points (1100 is 11%).
	CommissionBps map[string]int
	// PSPBaseURL is the payment provider, PSPCallbackURL is where it reports the outcome of a charge, and
	// PSPWebhookToken is the secret it sends along, which the webhook checks.
	PSPBaseURL      string
	PSPCallbackURL  string
	PSPWebhookToken string
	// PaymentPollInterval is how often the invoices that are due are charged, and ReconcileInterval how
	// often the charges that stayed pending are asked about. A charge is asked about once it has been
	// pending for more than ReconcileAfter, which gives the webhook time to arrive first.
	PaymentPollInterval time.Duration
	ReconcileInterval   time.Duration
	ReconcileAfter      time.Duration
}

// Lookup reads one variable, like os.LookupEnv.
type Lookup func(key string) (string, bool)

// Problem names an invalid variable and why. It never carries the value, which
// may be a credential.
type Problem struct {
	Variable string
	Reason   string
}

// InvalidError lists every invalid variable.
type InvalidError struct {
	Problems []Problem
}

func (e *InvalidError) Error() string {
	parts := make([]string, len(e.Problems))
	for i, problem := range e.Problems {
		parts[i] = problem.Variable + ": " + problem.Reason
	}
	return "invalid configuration: " + strings.Join(parts, "; ")
}

// FromEnv loads the configuration from the process environment.
func FromEnv() (Config, error) {
	return Load(os.LookupEnv)
}

// Load validates every variable and reports all the invalid ones together.
func Load(lookup Lookup) (Config, error) {
	reader := reader{lookup: lookup}

	port := reader.port()
	cfg := Config{
		Port:               port,
		LogLevel:           reader.logLevel(),
		ServiceName:        reader.text("OTEL_SERVICE_NAME", defaultServiceName),
		OTelCollectorURL:   reader.collectorURL(),
		DatabaseURL:        reader.databaseURL(),
		KafkaBrokers:       reader.kafkaBrokers(),
		OutboxPollInterval: reader.duration("OUTBOX_POLL_INTERVAL", defaultOutboxPollInterval),
		ConsumerGroup:      reader.kafkaName("KAFKA_CONSUMER_GROUP", "billing-service"),
		ConfirmedTopic:     reader.kafkaName("ORDER_CONFIRMED_TOPIC", "order.order.confirmed.v1"),
		CancelledTopic:     reader.kafkaName("ORDER_CANCELLED_TOPIC", "order.order.cancelled.v1"),
		DeadLetterTopic:    reader.kafkaName("ORDER_EVENTS_DLQ_TOPIC", "billing.order-events.dlq"),
		CommissionBps: map[string]int{
			"AMAZON":        reader.percentBps("COMMISSION_AMAZON_PERCENT", 1200),
			"MERCADO_LIVRE": reader.percentBps("COMMISSION_MERCADO_LIVRE_PERCENT", 1100),
			"SHOPEE":        reader.percentBps("COMMISSION_SHOPEE_PERCENT", 1400),
		},
		PSPBaseURL: reader.httpURL("PSP_BASE_URL", defaultPSPBaseURL),
		// The default reaches a service that runs on the host from the WireMock of the compose file.
		PSPCallbackURL:      reader.httpURL("PSP_CALLBACK_URL", fmt.Sprintf("http://host.docker.internal:%d/webhooks/psp", port)),
		PSPWebhookToken:     reader.required("PSP_WEBHOOK_TOKEN"),
		PaymentPollInterval: reader.duration("PAYMENT_POLL_INTERVAL", defaultPaymentInterval),
		ReconcileInterval:   reader.duration("RECONCILE_INTERVAL", defaultReconcileInterval),
		ReconcileAfter:      reader.duration("RECONCILE_AFTER", defaultReconcileAfter),
	}

	if len(reader.problems) > 0 {
		return Config{}, &InvalidError{Problems: reader.problems}
	}
	return cfg, nil
}

type reader struct {
	lookup   Lookup
	problems []Problem
}

func (r *reader) value(name string) (string, bool) {
	raw, ok := r.lookup(name)
	raw = strings.TrimSpace(raw)
	return raw, ok && raw != ""
}

func (r *reader) invalid(name, reason string) {
	r.problems = append(r.problems, Problem{Variable: name, Reason: reason})
}

func (r *reader) text(name, fallback string) string {
	if raw, ok := r.value(name); ok {
		return raw
	}
	return fallback
}

func (r *reader) port() int {
	raw, ok := r.value("PORT")
	if !ok {
		return defaultPort
	}
	port, err := strconv.Atoi(raw)
	if err != nil || port < 1 || port > maxPort {
		r.invalid("PORT", "must be an integer between 1 and 65535")
		return 0
	}
	return port
}

func (r *reader) logLevel() slog.Level {
	raw, ok := r.value("LOG_LEVEL")
	if !ok {
		return slog.LevelInfo
	}
	switch strings.ToLower(raw) {
	case "debug":
		return slog.LevelDebug
	case "info":
		return slog.LevelInfo
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	}
	r.invalid("LOG_LEVEL", "must be one of debug, info, warn, error")
	return slog.LevelInfo
}

func (r *reader) collectorURL() string {
	return r.httpURL("OTEL_COLLECTOR_URL", defaultOTelCollectorURL)
}

func (r *reader) httpURL(name, fallback string) string {
	raw, ok := r.value(name)
	if !ok {
		return fallback
	}
	if !hasURLShape(raw, "http", "https") {
		r.invalid(name, "must be an http or https URL with a host")
		return fallback
	}
	return raw
}

func (r *reader) required(name string) string {
	raw, ok := r.value(name)
	if !ok {
		r.invalid(name, "is required")
	}
	return raw
}

func (r *reader) databaseURL() string {
	raw, ok := r.value("DATABASE_URL")
	if !ok {
		r.invalid("DATABASE_URL", "is required")
		return ""
	}
	if !hasURLShape(raw, "postgres", "postgresql") {
		r.invalid("DATABASE_URL", "must be a postgres or postgresql URL with a host")
		return ""
	}
	return raw
}

func (r *reader) kafkaBrokers() []string {
	raw, ok := r.value("KAFKA_BROKERS")
	if !ok {
		raw = defaultKafkaBrokers
	}
	var brokers []string
	for _, broker := range strings.Split(raw, ",") {
		if broker = strings.TrimSpace(broker); broker != "" {
			brokers = append(brokers, broker)
		}
	}
	if len(brokers) == 0 {
		r.invalid("KAFKA_BROKERS", "must list at least one host:port")
		return nil
	}
	for _, broker := range brokers {
		if !isHostPort(broker) {
			r.invalid("KAFKA_BROKERS", "every broker must be host:port with a port from 1 to 65535")
			return nil
		}
	}
	return brokers
}

func (r *reader) duration(name string, fallback time.Duration) time.Duration {
	raw, ok := r.value(name)
	if !ok {
		return fallback
	}
	parsed, err := time.ParseDuration(raw)
	if err != nil || parsed <= 0 {
		r.invalid(name, "must be a positive duration such as 500ms or 2s")
		return fallback
	}
	return parsed
}

var kafkaNamePattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,249}$`)

func (r *reader) kafkaName(name, fallback string) string {
	raw, ok := r.value(name)
	if !ok {
		return fallback
	}
	if !kafkaNamePattern.MatchString(raw) {
		r.invalid(name, "must be 1 to 249 letters, digits, dots, underscores or hyphens")
		return fallback
	}
	return raw
}

// percentBps reads a percentage from 0 to 100 with at most two decimals and returns
// it in basis points. A percentage with two decimals has the scale of an amount in cents.
func (r *reader) percentBps(name string, fallback int) int {
	raw, ok := r.value(name)
	if !ok {
		return fallback
	}
	bps, err := model.ParseMoney(raw)
	if err != nil || bps > maxPercentBps {
		r.invalid(name, "must be a percentage from 0 to 100 with at most two decimals")
		return fallback
	}
	return int(bps)
}

func hasURLShape(raw string, schemes ...string) bool {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Hostname() == "" {
		return false
	}
	for _, scheme := range schemes {
		if parsed.Scheme == scheme {
			return true
		}
	}
	return false
}

func isHostPort(raw string) bool {
	host, port, err := net.SplitHostPort(raw)
	if err != nil || host == "" {
		return false
	}
	number, err := strconv.Atoi(port)
	return err == nil && number >= 1 && number <= maxPort
}
