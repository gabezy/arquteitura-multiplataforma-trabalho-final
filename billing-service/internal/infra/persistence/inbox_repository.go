package persistence

import (
	"context"
	"fmt"
)

// InboxRepository records the Kafka events already processed, by CloudEvents id.
type InboxRepository struct {
	db *Database
}

func NewInboxRepository(db *Database) *InboxRepository {
	return &InboxRepository{db: db}
}

// MarkProcessed records the event id and reports whether it was new. Called inside
// the transaction of the use case, the mark disappears if that transaction rolls back.
func (r *InboxRepository) MarkProcessed(ctx context.Context, eventID, eventType string) (bool, error) {
	tag, err := r.db.Querier(ctx).Exec(ctx,
		`INSERT INTO processed_events (event_id, event_type) VALUES ($1, $2) ON CONFLICT (event_id) DO NOTHING`,
		eventID, eventType)
	if err != nil {
		return false, fmt.Errorf("mark event processed: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}
