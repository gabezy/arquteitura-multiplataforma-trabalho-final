// Package config reads the service configuration from environment variables.
package config

import (
	"log/slog"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	defaultPort               = 8086
	defaultServiceName        = "billing-service"
	defaultOTelCollectorURL   = "http://localhost:4318"
	defaultKafkaBrokers       = "localhost:9092"
	defaultOutboxPollInterval = time.Second
	maxPort                   = 65535
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

	cfg := Config{
		Port:               reader.port(),
		LogLevel:           reader.logLevel(),
		ServiceName:        reader.text("OTEL_SERVICE_NAME", defaultServiceName),
		OTelCollectorURL:   reader.collectorURL(),
		DatabaseURL:        reader.databaseURL(),
		KafkaBrokers:       reader.kafkaBrokers(),
		OutboxPollInterval: reader.duration("OUTBOX_POLL_INTERVAL", defaultOutboxPollInterval),
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
	raw, ok := r.value("OTEL_COLLECTOR_URL")
	if !ok {
		return defaultOTelCollectorURL
	}
	if !hasURLShape(raw, "http", "https") {
		r.invalid("OTEL_COLLECTOR_URL", "must be an http or https URL with a host")
		return ""
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
