package persistence

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// OrderCancellationRepository remembers the orders cancelled before their invoice existed.
type OrderCancellationRepository struct {
	db *Database
}

func NewOrderCancellationRepository(db *Database) *OrderCancellationRepository {
	return &OrderCancellationRepository{db: db}
}

// Record is idempotent: the first cancellation of an order wins.
func (r *OrderCancellationRepository) Record(ctx context.Context, orderID, reason string, at time.Time) error {
	if _, err := uuid.Parse(orderID); err != nil {
		return fmt.Errorf("record cancellation: order id is not a uuid")
	}
	_, err := r.db.Querier(ctx).Exec(ctx,
		`INSERT INTO order_cancellations (order_id, reason, cancelled_at) VALUES ($1, NULLIF($2, ''), $3)
		 ON CONFLICT (order_id) DO NOTHING`, orderID, reason, at)
	if err != nil {
		return fmt.Errorf("record cancellation: %w", err)
	}
	return nil
}

// IsCancelled reports whether a cancellation was recorded for the order.
func (r *OrderCancellationRepository) IsCancelled(ctx context.Context, orderID string) (bool, error) {
	if _, err := uuid.Parse(orderID); err != nil {
		return false, nil
	}
	var cancelled bool
	err := r.db.Querier(ctx).QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM order_cancellations WHERE order_id = $1)`, orderID).Scan(&cancelled)
	if err != nil {
		return false, fmt.Errorf("read cancellation: %w", err)
	}
	return cancelled, nil
}
