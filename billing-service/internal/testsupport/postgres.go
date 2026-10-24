// Package testsupport starts the containers the integration tests share.
package testsupport

import (
	"context"
	"fmt"
	"net/url"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
)

const postgresImage = "postgres:18-alpine"

var (
	postgresOnce      sync.Once
	postgresContainer *postgres.PostgresContainer
	postgresAdminURL  string
	postgresErr       error
	databaseCounter   atomic.Int64
)

// NewDatabase returns the URL of a new empty database inside a Postgres
// container that the whole test binary shares, so each test gets isolation
// without paying for a container.
func NewDatabase(tb testing.TB) string {
	tb.Helper()
	ctx := context.Background()

	postgresOnce.Do(func() { startPostgres(ctx) })
	if postgresErr != nil {
		tb.Fatalf("start postgres container (is Docker running?): %v", postgresErr)
	}

	name := fmt.Sprintf("test_%d", databaseCounter.Add(1))
	admin, err := pgx.Connect(ctx, postgresAdminURL)
	if err != nil {
		tb.Fatalf("connect to postgres: %v", err)
	}
	defer admin.Close(ctx)
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+name); err != nil {
		tb.Fatalf("create database %s: %v", name, err)
	}

	databaseURL, err := url.Parse(postgresAdminURL)
	if err != nil {
		tb.Fatalf("parse postgres url: %v", err)
	}
	databaseURL.Path = "/" + name
	return databaseURL.String()
}

// Terminate stops the shared container. Call it from TestMain after m.Run.
func Terminate() {
	if postgresContainer != nil {
		_ = testcontainers.TerminateContainer(postgresContainer)
	}
}

func startPostgres(ctx context.Context) {
	postgresContainer, postgresErr = postgres.Run(ctx, postgresImage,
		postgres.WithDatabase("postgres"),
		postgres.WithUsername("billing"),
		postgres.WithPassword("billing"),
		postgres.BasicWaitStrategies(),
	)
	if postgresErr != nil {
		return
	}
	postgresAdminURL, postgresErr = postgresContainer.ConnectionString(ctx, "sslmode=disable")
}
