// Package persistence holds the Postgres connection, the unit of work and the migrations.
package persistence

import (
	"context"
	"fmt"

	"github.com/exaring/otelpgx"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Querier runs statements on the open transaction or, outside one, on the pool.
type Querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type transactionKey struct{}

// Database is the pool plus the unit of work. The transaction travels in the
// context, so the ports of the core need no transaction type and a repository
// call made inside WithinTransaction joins it.
type Database struct {
	pool *pgxpool.Pool
}

// Open connects with the otelpgx tracer and checks the connection.
func Open(ctx context.Context, databaseURL string) (*Database, error) {
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}
	config.ConnConfig.Tracer = otelpgx.NewTracer()

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("create database pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}
	return &Database{pool: pool}, nil
}

// Close releases the pool.
func (d *Database) Close() {
	d.pool.Close()
}

// Ping checks that the database answers.
func (d *Database) Ping(ctx context.Context) error {
	return d.pool.Ping(ctx)
}

// Querier returns the open transaction of ctx, or the pool.
func (d *Database) Querier(ctx context.Context) Querier {
	if tx, ok := ctx.Value(transactionKey{}).(pgx.Tx); ok {
		return tx
	}
	return d.pool
}

// WithinTransaction runs fn in one transaction: it commits when fn returns nil
// and rolls back otherwise. A call made inside another one joins the outer
// transaction, which alone decides the outcome.
func (d *Database) WithinTransaction(ctx context.Context, fn func(ctx context.Context) error) error {
	if _, ok := ctx.Value(transactionKey{}).(pgx.Tx); ok {
		return fn(ctx)
	}

	tx, err := d.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	// After a successful Commit this is a no-op; on an error or a panic it rolls back.
	defer func() { _ = tx.Rollback(ctx) }()

	if err := fn(context.WithValue(ctx, transactionKey{}, tx)); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}
	return nil
}
