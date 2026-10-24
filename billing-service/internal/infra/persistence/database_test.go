package persistence_test

import (
	"context"
	"errors"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/persistence"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/testsupport"
)

func TestMain(m *testing.M) {
	code := m.Run()
	testsupport.Terminate()
	os.Exit(code)
}

func openMigrated(t *testing.T) *persistence.Database {
	t.Helper()
	url := testsupport.NewDatabase(t)
	if err := persistence.Migrate(context.Background(), url); err != nil {
		t.Fatalf("Migrate() error = %v", err)
	}
	return open(t, url)
}

func open(t *testing.T, url string) *persistence.Database {
	t.Helper()
	db, err := persistence.Open(context.Background(), url)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(db.Close)
	return db
}

// BOOT-03: pending migrations are applied, and applying them again changes nothing.
func TestMigrateCreatesTheOutboxAndInboxTablesAndIsIdempotent(t *testing.T) {
	ctx := context.Background()
	url := testsupport.NewDatabase(t)

	for attempt := 1; attempt <= 2; attempt++ {
		if err := persistence.Migrate(ctx, url); err != nil {
			t.Fatalf("Migrate() attempt %d error = %v", attempt, err)
		}
	}

	db := open(t, url)
	var hasOutbox, hasInbox bool
	err := db.Querier(ctx).QueryRow(ctx,
		`SELECT to_regclass('public.outbox') IS NOT NULL, to_regclass('public.processed_events') IS NOT NULL`,
	).Scan(&hasOutbox, &hasInbox)
	if err != nil {
		t.Fatal(err)
	}
	if !hasOutbox || !hasInbox {
		t.Fatalf("outbox exists = %v, processed_events exists = %v, want both true", hasOutbox, hasInbox)
	}

	var applied int
	if err := db.Querier(ctx).QueryRow(ctx, `SELECT count(*) FROM goose_db_version WHERE version_id = 1 AND is_applied`).Scan(&applied); err != nil {
		t.Fatal(err)
	}
	if applied != 1 {
		t.Fatalf("migration 1 recorded %d times, want 1", applied)
	}
}

func TestOutboxTableHasTheColumnsOfTheOutboxRelay(t *testing.T) {
	ctx := context.Background()
	db := openMigrated(t)

	rows, err := db.Querier(ctx).Query(ctx,
		`SELECT column_name FROM information_schema.columns WHERE table_name = 'outbox' ORDER BY column_name`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var got []string
	for rows.Next() {
		var column string
		if err := rows.Scan(&column); err != nil {
			t.Fatal(err)
		}
		got = append(got, column)
	}

	want := []string{"aggregate_id", "aggregate_type", "event_id", "event_type", "headers", "occurred_at", "payload", "published_at", "sequence"}
	if !slices.Equal(got, want) {
		t.Fatalf("outbox columns = %v, want %v", got, want)
	}
}

func TestOpenReportsAnUnreachableDatabaseWithoutPrintingTheCredentials(t *testing.T) {
	_, err := persistence.Open(context.Background(), "postgresql://billing:pw-8c41e@127.0.0.1:1/billing")

	if err == nil {
		t.Fatal("Open() error = nil, want an error")
	}
	if strings.Contains(err.Error(), "pw-8c41e") {
		t.Fatalf("error %q prints the database password", err)
	}
}

func createProbeTable(t *testing.T) (*persistence.Database, func() int) {
	t.Helper()
	ctx := context.Background()
	db := open(t, testsupport.NewDatabase(t))
	if _, err := db.Querier(ctx).Exec(ctx, `CREATE TABLE tx_probe (id int)`); err != nil {
		t.Fatal(err)
	}
	count := func() int {
		var n int
		if err := db.Querier(ctx).QueryRow(ctx, `SELECT count(*) FROM tx_probe`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	return db, count
}

func insertProbe(ctx context.Context, db *persistence.Database, id int) error {
	_, err := db.Querier(ctx).Exec(ctx, `INSERT INTO tx_probe (id) VALUES ($1)`, id)
	return err
}

func TestWithinTransactionCommitsWhenTheFunctionSucceeds(t *testing.T) {
	ctx := context.Background()
	db, count := createProbeTable(t)

	err := db.WithinTransaction(ctx, func(ctx context.Context) error { return insertProbe(ctx, db, 1) })

	if err != nil {
		t.Fatal(err)
	}
	if got := count(); got != 1 {
		t.Fatalf("rows after commit = %d, want 1", got)
	}
}

func TestWithinTransactionRollsBackAndReturnsTheFunctionError(t *testing.T) {
	ctx := context.Background()
	db, count := createProbeTable(t)
	boom := errors.New("boom")

	err := db.WithinTransaction(ctx, func(ctx context.Context) error {
		if err := insertProbe(ctx, db, 1); err != nil {
			return err
		}
		return boom
	})

	if !errors.Is(err, boom) {
		t.Fatalf("WithinTransaction() error = %v, want %v", err, boom)
	}
	if got := count(); got != 0 {
		t.Fatalf("rows after rollback = %d, want 0", got)
	}
}

func TestNestedWithinTransactionJoinsTheOuterTransaction(t *testing.T) {
	ctx := context.Background()
	boom := errors.New("boom")

	t.Run("an outer error rolls the inner work back too", func(t *testing.T) {
		db, count := createProbeTable(t)
		err := db.WithinTransaction(ctx, func(ctx context.Context) error {
			if err := insertProbe(ctx, db, 1); err != nil {
				return err
			}
			if err := db.WithinTransaction(ctx, func(ctx context.Context) error { return insertProbe(ctx, db, 2) }); err != nil {
				return err
			}
			return boom
		})
		if !errors.Is(err, boom) {
			t.Fatalf("error = %v, want %v", err, boom)
		}
		if got := count(); got != 0 {
			t.Fatalf("rows = %d, want 0: the inner call must not commit on its own", got)
		}
	})

	t.Run("both commit together when the outer one succeeds", func(t *testing.T) {
		db, count := createProbeTable(t)
		err := db.WithinTransaction(ctx, func(ctx context.Context) error {
			if err := insertProbe(ctx, db, 1); err != nil {
				return err
			}
			return db.WithinTransaction(ctx, func(ctx context.Context) error { return insertProbe(ctx, db, 2) })
		})
		if err != nil {
			t.Fatal(err)
		}
		if got := count(); got != 2 {
			t.Fatalf("rows = %d, want 2", got)
		}
	})
}

func TestQuerierOutsideATransactionUsesThePoolDirectly(t *testing.T) {
	ctx := context.Background()
	db, count := createProbeTable(t)

	if err := insertProbe(ctx, db, 1); err != nil {
		t.Fatal(err)
	}

	if got := count(); got != 1 {
		t.Fatalf("rows = %d, want 1", got)
	}
}
