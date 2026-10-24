package persistence

import (
	"context"
	"embed"
	"fmt"
	"io/fs"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/pressly/goose/v3/lock"
)

// The migrations travel inside the binary: the runtime image has no shell to run a migrate command.
//
//go:embed migrations/*.sql
var migrationFiles embed.FS

// Migrate applies the pending migrations. A Postgres advisory lock keeps two
// instances that start together (a rolling deploy) from migrating at once.
// Migrations must stay backward compatible (expand/contract), because the old
// version keeps running on the new schema during a deploy.
func Migrate(ctx context.Context, databaseURL string) error {
	connConfig, err := pgx.ParseConfig(databaseURL)
	if err != nil {
		return fmt.Errorf("parse database url: %w", err)
	}
	db := stdlib.OpenDB(*connConfig)
	defer db.Close()

	migrations, err := fs.Sub(migrationFiles, "migrations")
	if err != nil {
		return fmt.Errorf("open embedded migrations: %w", err)
	}
	locker, err := lock.NewPostgresSessionLocker()
	if err != nil {
		return fmt.Errorf("create migration lock: %w", err)
	}
	provider, err := goose.NewProvider(goose.DialectPostgres, db, migrations, goose.WithSessionLocker(locker))
	if err != nil {
		return fmt.Errorf("create migration provider: %w", err)
	}
	if _, err := provider.Up(ctx); err != nil {
		return fmt.Errorf("apply migrations: %w", err)
	}
	return nil
}
