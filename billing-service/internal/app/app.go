// Package app is the composition root: it opens the resources, wires the
// adapters to the core and runs the service until its context ends.
package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/config"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/httpapi"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/messaging"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/outbox"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/persistence"
)

// ShutdownTimeout is how long Run takes to stop once its context ends. With the
// 2 s that main keeps to flush the telemetry, the process exits within 10 s.
const ShutdownTimeout = 7 * time.Second

var errShutdownTimedOut = errors.New("shutdown timed out")

// Run migrates the database, then serves HTTP and runs the background loops
// until ctx ends. It returns nil after a clean shutdown.
func Run(ctx context.Context, cfg config.Config, logger *slog.Logger) error {
	// The migrations run before anything listens, so no request meets an old schema.
	if err := persistence.Migrate(ctx, cfg.DatabaseURL); err != nil {
		return err
	}

	db, err := persistence.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer db.Close()

	kafkaClient, err := messaging.NewProducerClient(cfg.KafkaBrokers)
	if err != nil {
		return err
	}
	defer kafkaClient.Close()

	relay := outbox.NewRelay(db, outbox.NewKafkaProducer(kafkaClient), logger, outbox.RelayOptions{
		PollInterval: cfg.OutboxPollInterval,
	})
	router := httpapi.NewRouter(httpapi.Deps{Logger: logger, CheckHealth: db.Ping})
	server := httpapi.NewServer(fmt.Sprintf(":%d", cfg.Port), router.Handler())

	group, groupCtx := errgroup.WithContext(ctx)
	group.Go(func() error {
		logger.InfoContext(groupCtx, "billing-service listening", "port", cfg.Port)
		if err := server.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
			return fmt.Errorf("serve http: %w", err)
		}
		return nil
	})
	group.Go(func() error { return relay.Run(groupCtx) })
	group.Go(func() error {
		<-groupCtx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(groupCtx), ShutdownTimeout)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			return fmt.Errorf("shut down http server: %w", err)
		}
		return nil
	})

	return waitWithin(group, groupCtx, logger)
}

// waitWithin waits for the group. From the moment the context ends it allows
// ShutdownTimeout for everything to stop.
func waitWithin(group *errgroup.Group, groupCtx context.Context, logger *slog.Logger) error {
	done := make(chan error, 1)
	go func() { done <- group.Wait() }()

	select {
	case err := <-done:
		return err
	case <-groupCtx.Done():
	}

	logger.Info("billing-service stopping")
	select {
	case err := <-done:
		return err
	case <-time.After(ShutdownTimeout):
		return errShutdownTimedOut
	}
}
