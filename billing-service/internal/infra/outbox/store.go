// Package outbox implements the transactional outbox: events are stored with
// the aggregate, in the same transaction, and a relay publishes them to Kafka.
package outbox

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/shared/domain"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/persistence"
)

// ErrUnmappedEvent is returned by a Mapper for a domain event that must not leave the service.
var ErrUnmappedEvent = errors.New("event has no integration event mapping")

// IntegrationEvent is the public, versioned form of a domain event.
type IntegrationEvent struct {
	// Type is the public type, such as billing.invoice.issued.v1. It names the topic.
	Type string
	// AggregateType is the kind of aggregate the event belongs to, such as invoice.
	AggregateType string
	// Data is marshalled to the JSON value of the message.
	Data any
}

// Mapper turns a domain event into its integration event.
type Mapper func(event domain.DomainEvent) (IntegrationEvent, error)

// Store writes events to the outbox table.
type Store struct {
	db     *persistence.Database
	mapper Mapper
}

func NewStore(db *persistence.Database, mapper Mapper) *Store {
	return &Store{db: db, mapper: mapper}
}

type outboxRow struct {
	eventID       string
	aggregateType string
	aggregateID   string
	eventType     string
	payload       string
	occurredAt    time.Time
}

// Append stores the integration events of the domain events. It joins the
// transaction of ctx, so the events exist if and only if that transaction
// commits. If any event has no mapping, nothing is written.
func (s *Store) Append(ctx context.Context, events []domain.DomainEvent) error {
	if len(events) == 0 {
		return nil
	}

	rows := make([]outboxRow, 0, len(events))
	for _, event := range events {
		mapped, err := s.mapper(event)
		if err != nil {
			return fmt.Errorf("map event %s: %w", event.EventName(), err)
		}
		payload, err := json.Marshal(mapped.Data)
		if err != nil {
			return fmt.Errorf("marshal event %s: %w", event.EventName(), err)
		}
		rows = append(rows, outboxRow{
			eventID:       uuid.NewString(),
			aggregateType: mapped.AggregateType,
			aggregateID:   event.AggregateID(),
			eventType:     mapped.Type,
			payload:       string(payload),
			occurredAt:    event.OccurredAt(),
		})
	}

	headers, err := traceHeaders(ctx)
	if err != nil {
		return err
	}

	return s.db.WithinTransaction(ctx, func(ctx context.Context) error {
		for _, row := range rows {
			_, err := s.db.Querier(ctx).Exec(ctx,
				`INSERT INTO outbox (event_id, aggregate_type, aggregate_id, event_type, payload, headers, occurred_at)
				 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
				row.eventID, row.aggregateType, row.aggregateID, row.eventType, row.payload, headers, row.occurredAt)
			if err != nil {
				return fmt.Errorf("insert outbox row: %w", err)
			}
		}
		return nil
	})
}

// traceHeaders saves the trace context active in ctx, so the relay can publish
// the event inside the trace of the request or message that produced it.
func traceHeaders(ctx context.Context) (any, error) {
	carrier := propagation.MapCarrier{}
	otel.GetTextMapPropagator().Inject(ctx, carrier)
	if len(carrier) == 0 {
		return nil, nil
	}
	encoded, err := json.Marshal(map[string]string(carrier))
	if err != nil {
		return nil, fmt.Errorf("marshal trace headers: %w", err)
	}
	return string(encoded), nil
}
