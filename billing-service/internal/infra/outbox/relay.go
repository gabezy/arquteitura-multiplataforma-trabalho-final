package outbox

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/persistence"
)

const (
	defaultBatchSize    = 100
	defaultPollInterval = time.Second
	defaultSource       = "/billing-service"
	// batchTimeout bounds the database work of one batch, which outlives a cancelled ctx.
	batchTimeout = 30 * time.Second
)

// Header is one Kafka record header.
type Header struct {
	Key   string
	Value string
}

// Record is a message ready for Kafka.
type Record struct {
	Topic   string
	Key     string
	Value   []byte
	Headers []Header
}

// Producer delivers a record to Kafka and returns once the broker acknowledged it.
// The trace context of ctx travels with the record.
type Producer interface {
	Produce(ctx context.Context, record Record) error
}

// RelayOptions tunes the relay; zero values take the defaults.
type RelayOptions struct {
	BatchSize    int
	PollInterval time.Duration
	// Source is the CloudEvents source attribute.
	Source string
}

// Relay publishes the pending outbox rows to Kafka, in sequence order.
type Relay struct {
	db       *persistence.Database
	producer Producer
	logger   *slog.Logger
	options  RelayOptions
}

func NewRelay(db *persistence.Database, producer Producer, logger *slog.Logger, options RelayOptions) *Relay {
	if options.BatchSize <= 0 {
		options.BatchSize = defaultBatchSize
	}
	if options.PollInterval <= 0 {
		options.PollInterval = defaultPollInterval
	}
	if options.Source == "" {
		options.Source = defaultSource
	}
	return &Relay{db: db, producer: producer, logger: logger, options: options}
}

type pendingRow struct {
	sequence    int64
	eventID     string
	aggregateID string
	eventType   string
	payload     []byte
	headers     []byte
	occurredAt  time.Time
}

// Run publishes new events every poll interval until ctx ends. It returns nil
// on cancellation, after the batch in progress has been marked.
func (r *Relay) Run(ctx context.Context) error {
	for {
		for {
			published, err := r.PublishPending(ctx)
			if err != nil {
				if ctx.Err() != nil {
					return nil
				}
				r.logger.ErrorContext(ctx, "publishing outbox events failed", "error", err.Error())
				break
			}
			if published < r.options.BatchSize {
				break
			}
		}

		select {
		case <-ctx.Done():
			return nil
		case <-time.After(r.options.PollInterval):
		}
	}
}

// PublishPending publishes one batch and returns how many events were sent. It
// locks the batch with SKIP LOCKED, so two instances never send the same row, and
// it stops at the first failure so that the failed event and the later ones stay
// pending. Delivery is at-least-once: a crash after Produce and before the commit
// sends the event again.
func (r *Relay) PublishPending(ctx context.Context) (int, error) {
	// The database work does not end with ctx: what was already sent must be marked
	// as published even when the service is shutting down.
	dbCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), batchTimeout)
	defer cancel()

	var sent int
	var produceErr error
	err := r.db.WithinTransaction(dbCtx, func(txCtx context.Context) error {
		pending, err := r.lockPending(txCtx)
		if err != nil {
			return err
		}

		var sequences []int64
		for _, row := range pending {
			if err := ctx.Err(); err != nil {
				produceErr = err
				break
			}
			if err := r.producer.Produce(traceContext(ctx, row.headers), r.record(row)); err != nil {
				produceErr = fmt.Errorf("publish event %s: %w", row.eventID, err)
				break
			}
			sequences = append(sequences, row.sequence)
		}

		sent = len(sequences)
		if sent == 0 {
			return nil
		}
		_, err = r.db.Querier(txCtx).Exec(txCtx, `UPDATE outbox SET published_at = now() WHERE sequence = ANY($1)`, sequences)
		return err
	})
	if err != nil {
		return 0, fmt.Errorf("publish pending events: %w", err)
	}
	return sent, produceErr
}

func (r *Relay) lockPending(ctx context.Context) ([]pendingRow, error) {
	rows, err := r.db.Querier(ctx).Query(ctx,
		`SELECT sequence, event_id::text, aggregate_id::text, event_type, payload, headers, occurred_at
		   FROM outbox
		  WHERE published_at IS NULL
		  ORDER BY sequence
		  LIMIT $1
		  FOR UPDATE SKIP LOCKED`, r.options.BatchSize)
	if err != nil {
		return nil, fmt.Errorf("select pending outbox rows: %w", err)
	}
	defer rows.Close()

	var pending []pendingRow
	for rows.Next() {
		var row pendingRow
		if err := rows.Scan(&row.sequence, &row.eventID, &row.aggregateID, &row.eventType, &row.payload, &row.headers, &row.occurredAt); err != nil {
			return nil, fmt.Errorf("scan outbox row: %w", err)
		}
		pending = append(pending, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read outbox rows: %w", err)
	}
	return pending, nil
}

// record builds the CloudEvents binary-mode message: attributes in ce_* headers,
// the JSON data as the value, and the topic named after the event type.
func (r *Relay) record(row pendingRow) Record {
	return Record{
		Topic: row.eventType,
		Key:   row.aggregateID,
		Value: row.payload,
		Headers: []Header{
			{Key: "ce_specversion", Value: "1.0"},
			{Key: "ce_id", Value: row.eventID},
			{Key: "ce_source", Value: r.options.Source},
			{Key: "ce_type", Value: row.eventType},
			{Key: "ce_subject", Value: row.aggregateID},
			{Key: "ce_time", Value: row.occurredAt.UTC().Format(time.RFC3339Nano)},
			{Key: "content-type", Value: "application/json"},
		},
	}
}

// traceContext restores the trace context saved with the row as the remote parent of the send.
func traceContext(ctx context.Context, stored []byte) context.Context {
	if len(stored) == 0 {
		return ctx
	}
	var carrier map[string]string
	if err := json.Unmarshal(stored, &carrier); err != nil {
		return ctx
	}
	return otel.GetTextMapPropagator().Extract(ctx, propagation.MapCarrier(carrier))
}
