package persistence

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/model"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/shared/domain"
)

const (
	defaultListLimit      = 20
	uniqueViolationCode   = "23505"
	orderUniqueConstraint = "invoices_order_id_unique"

	invoiceColumns = `id::text, order_id::text, COALESCE(external_order_id, ''), marketplace, total_cents,
		commission_rate_bps, commission_cents, net_cents, status, issued_at, cancelled_at,
		COALESCE(cancellation_reason, ''), updated_at, version`
)

// EventAppender stores the events an aggregate recorded in the outbox. The
// repository calls it inside its own transaction, so an event exists if and only
// if the invoice does. The outbox Store implements it.
type EventAppender interface {
	Append(ctx context.Context, events []domain.DomainEvent) error
}

// InvoiceRepository keeps invoices in Postgres.
type InvoiceRepository struct {
	db     *Database
	events EventAppender
}

func NewInvoiceRepository(db *Database, events EventAppender) *InvoiceRepository {
	return &InvoiceRepository{db: db, events: events}
}

// Save inserts a new invoice (version zero) or updates a loaded one, only if
// nobody changed it since it was loaded, and hands the recorded events to the
// outbox in the same transaction.
func (r *InvoiceRepository) Save(ctx context.Context, invoice *model.Invoice) error {
	snapshot := invoice.Snapshot()
	return r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		var err error
		if snapshot.Version == 0 {
			err = r.insert(ctx, snapshot)
		} else {
			err = r.update(ctx, snapshot)
		}
		if err != nil {
			return err
		}
		return r.events.Append(ctx, invoice.PullEvents())
	})
}

func (r *InvoiceRepository) insert(ctx context.Context, s model.Snapshot) error {
	q := r.db.Querier(ctx)
	_, err := q.Exec(ctx,
		`INSERT INTO invoices (id, order_id, external_order_id, marketplace, total_cents, commission_rate_bps,
		                       commission_cents, net_cents, status, issued_at, cancelled_at, cancellation_reason, updated_at, version)
		 VALUES ($1, $2, NULLIF($3, ''), $4, $5, $6, $7, $8, $9, $10, $11, NULLIF($12, ''), $13, 1)`,
		s.ID, s.OrderID, s.ExternalOrderID, string(s.Marketplace), s.Total.Cents(), s.CommissionRateBps,
		s.Commission.Cents(), s.Net.Cents(), string(s.Status), s.IssuedAt, s.CancelledAt, s.CancellationReason, s.UpdatedAt)
	if isUniqueViolation(err, orderUniqueConstraint) {
		return domain.NewConflictError("order %s already has an invoice", s.OrderID)
	}
	if err != nil {
		return fmt.Errorf("insert invoice: %w", err)
	}

	for line, item := range s.Items {
		_, err := q.Exec(ctx,
			`INSERT INTO invoice_items (invoice_id, line, sku, quantity, unit_price_cents) VALUES ($1, $2, $3, $4, $5)`,
			s.ID, line, item.SKU, item.Quantity, item.UnitPrice.Cents())
		if err != nil {
			return fmt.Errorf("insert invoice item: %w", err)
		}
	}
	return nil
}

func (r *InvoiceRepository) update(ctx context.Context, s model.Snapshot) error {
	tag, err := r.db.Querier(ctx).Exec(ctx,
		`UPDATE invoices
		    SET status = $3, cancelled_at = $4, cancellation_reason = NULLIF($5, ''), updated_at = $6, version = version + 1
		  WHERE id = $1 AND version = $2`,
		s.ID, s.Version, string(s.Status), s.CancelledAt, s.CancellationReason, s.UpdatedAt)
	if err != nil {
		return fmt.Errorf("update invoice: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.NewConflictError("invoice %s was changed by another transaction", s.ID)
	}
	return nil
}

func (r *InvoiceRepository) FindByID(ctx context.Context, id string) (*model.Invoice, error) {
	return r.findBy(ctx, "id", id, "invoice "+id+" not found")
}

func (r *InvoiceRepository) FindByOrderID(ctx context.Context, orderID string) (*model.Invoice, error) {
	return r.findBy(ctx, "order_id", orderID, "order "+orderID+" has no invoice")
}

// findBy reads by a uuid column. A value that is not a uuid cannot match, so it
// is "not found" and not a database error.
func (r *InvoiceRepository) findBy(ctx context.Context, column, value, notFound string) (*model.Invoice, error) {
	if _, err := uuid.Parse(value); err != nil {
		return nil, domain.NewNotFoundError("%s", notFound)
	}

	snapshot, err := scanInvoice(r.db.Querier(ctx).QueryRow(ctx, `SELECT `+invoiceColumns+` FROM invoices WHERE `+column+` = $1`, value))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.NewNotFoundError("%s", notFound)
	}
	if err != nil {
		return nil, fmt.Errorf("read invoice: %w", err)
	}

	items, err := r.loadItems(ctx, []string{snapshot.ID})
	if err != nil {
		return nil, err
	}
	snapshot.Items = items[snapshot.ID]
	return model.Restore(snapshot), nil
}

// List returns the invoices that match the query, newest first. A limit of zero means 20.
func (r *InvoiceRepository) List(ctx context.Context, query model.InvoiceQuery) ([]model.Snapshot, error) {
	var conditions []string
	var args []any
	filter := func(condition string, value any) {
		args = append(args, value)
		conditions = append(conditions, strings.Replace(condition, "?", "$"+strconv.Itoa(len(args)), 1))
	}
	if query.OrderID != "" {
		if _, err := uuid.Parse(query.OrderID); err != nil {
			return nil, nil
		}
		filter("order_id = ?", query.OrderID)
	}
	if query.Status != "" {
		filter("status = ?", string(query.Status))
	}
	if query.Marketplace != "" {
		filter("marketplace = ?", string(query.Marketplace))
	}

	limit := query.Limit
	if limit <= 0 {
		limit = defaultListLimit
	}
	args = append(args, limit, max(query.Offset, 0))
	statement := `SELECT ` + invoiceColumns + ` FROM invoices`
	if len(conditions) > 0 {
		statement += ` WHERE ` + strings.Join(conditions, " AND ")
	}
	statement += ` ORDER BY issued_at DESC, id DESC LIMIT $` + strconv.Itoa(len(args)-1) + ` OFFSET $` + strconv.Itoa(len(args))

	rows, err := r.db.Querier(ctx).Query(ctx, statement, args...)
	if err != nil {
		return nil, fmt.Errorf("list invoices: %w", err)
	}
	defer rows.Close()

	var snapshots []model.Snapshot
	var ids []string
	for rows.Next() {
		snapshot, err := scanInvoice(rows)
		if err != nil {
			return nil, fmt.Errorf("scan invoice: %w", err)
		}
		snapshots = append(snapshots, snapshot)
		ids = append(ids, snapshot.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read invoices: %w", err)
	}
	rows.Close()

	if len(ids) == 0 {
		return nil, nil
	}
	items, err := r.loadItems(ctx, ids)
	if err != nil {
		return nil, err
	}
	for i := range snapshots {
		snapshots[i].Items = items[snapshots[i].ID]
	}
	return snapshots, nil
}

func (r *InvoiceRepository) loadItems(ctx context.Context, invoiceIDs []string) (map[string][]model.Item, error) {
	rows, err := r.db.Querier(ctx).Query(ctx,
		`SELECT invoice_id::text, sku, quantity, unit_price_cents
		   FROM invoice_items
		  WHERE invoice_id = ANY($1::uuid[])
		  ORDER BY invoice_id, line`, invoiceIDs)
	if err != nil {
		return nil, fmt.Errorf("read invoice items: %w", err)
	}
	defer rows.Close()

	items := map[string][]model.Item{}
	for rows.Next() {
		var invoiceID string
		var item model.Item
		var unitPrice int64
		if err := rows.Scan(&invoiceID, &item.SKU, &item.Quantity, &unitPrice); err != nil {
			return nil, fmt.Errorf("scan invoice item: %w", err)
		}
		item.UnitPrice = model.Money(unitPrice)
		items[invoiceID] = append(items[invoiceID], item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read invoice items: %w", err)
	}
	return items, nil
}

func scanInvoice(row pgx.Row) (model.Snapshot, error) {
	var s model.Snapshot
	var marketplace, status string
	var total, commission, net int64
	err := row.Scan(&s.ID, &s.OrderID, &s.ExternalOrderID, &marketplace, &total, &s.CommissionRateBps, &commission, &net,
		&status, &s.IssuedAt, &s.CancelledAt, &s.CancellationReason, &s.UpdatedAt, &s.Version)
	if err != nil {
		return model.Snapshot{}, err
	}
	s.Marketplace = model.Marketplace(marketplace)
	s.Status = model.Status(status)
	s.Total, s.Commission, s.Net = model.Money(total), model.Money(commission), model.Money(net)
	return s, nil
}

func isUniqueViolation(err error, constraint string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == uniqueViolationCode && pgErr.ConstraintName == constraint
}
