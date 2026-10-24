// Package app is the composition root: it opens the resources, wires the
// adapters to the core and runs the service until its context ends.
package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"

	"github.com/twmb/franz-go/pkg/kgo"
	"golang.org/x/sync/errgroup"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/model"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/config"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/httpapi"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/messaging"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/outbox"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/persistence"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/psp"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/system"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/worker"
)

// ShutdownTimeout is how long Run takes to stop once its context ends. With the
// 2 s that main keeps to flush the telemetry, the process exits within 10 s.
const ShutdownTimeout = 7 * time.Second

// leaveGroupTimeout bounds how long the consumer takes to leave its group on shutdown.
const leaveGroupTimeout = 3 * time.Second

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

	policies, err := commissionPolicies(cfg.CommissionBps)
	if err != nil {
		return err
	}
	store := outbox.NewStore(db, messaging.ToIntegrationEvent)
	invoiceRepository := persistence.NewInvoiceRepository(db, store)
	invoices := invoice.NewFacade(
		invoiceRepository,
		persistence.NewOrderCancellationRepository(db),
		db,
		system.UUIDGenerator{},
		system.Clock{},
		policies,
	)
	payments := invoice.NewPaymentFacade(
		invoiceRepository,
		db,
		psp.NewClient(psp.DefaultConfig(cfg.PSPBaseURL, cfg.PSPCallbackURL), logger),
		system.Clock{},
		invoice.PaymentOptions{ReconcileAfter: cfg.ReconcileAfter},
	)

	consumerClient, tracer, err := messaging.NewConsumerClient(cfg.KafkaBrokers, cfg.ConsumerGroup, cfg.ConfirmedTopic, cfg.CancelledTopic)
	if err != nil {
		return err
	}
	defer leaveAndClose(consumerClient)
	handler := messaging.NewOrderEventHandler(invoices, invoices, persistence.NewInboxRepository(db), db,
		messaging.OrderTopics{Confirmed: cfg.ConfirmedTopic, Cancelled: cfg.CancelledTopic}, logger)
	consumer := messaging.NewOrderEventsConsumer(consumerClient, tracer, handler,
		messaging.NewKafkaDeadLetter(kafkaClient, cfg.DeadLetterTopic), logger)

	relay := outbox.NewRelay(db, outbox.NewKafkaProducer(kafkaClient), logger, outbox.RelayOptions{
		PollInterval: cfg.OutboxPollInterval,
	})
	paymentWorker := worker.NewPaymentWorker(payments, cfg.PaymentPollInterval, logger)
	reconciliationWorker := worker.NewReconciliationWorker(payments, cfg.ReconcileInterval, logger)
	router := httpapi.NewRouter(httpapi.Deps{
		Logger:       logger,
		CheckHealth:  db.Ping,
		Invoices:     invoices,
		Payments:     payments,
		WebhookToken: cfg.PSPWebhookToken,
	})
	server := httpapi.NewServer(fmt.Sprintf(":%d", cfg.Port), router.Handler())
	// A request is allowed to finish while the server shuts down. When Run returns, which is when that time is over,
	// its context is cancelled (this defer runs before the one that closes the pool), so that a request that is still
	// waiting on the database gives its connection back. The pool waits for every connection in use when it closes,
	// and a request stuck on a lock would otherwise keep the process from exiting within its budget.
	handlers, stopHandlers := context.WithCancel(context.WithoutCancel(ctx))
	defer stopHandlers()
	server.BaseContext = func(net.Listener) context.Context { return handlers }

	group, groupCtx := errgroup.WithContext(ctx)
	group.Go(func() error {
		logger.InfoContext(groupCtx, "billing-service listening", "port", cfg.Port)
		if err := server.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
			return fmt.Errorf("serve http: %w", err)
		}
		return nil
	})
	group.Go(func() error { return relay.Run(groupCtx) })
	group.Go(func() error { return consumer.Run(groupCtx) })
	group.Go(func() error { return paymentWorker.Run(groupCtx) })
	group.Go(func() error { return reconciliationWorker.Run(groupCtx) })
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

func commissionPolicies(ratesBps map[string]int) (model.CommissionPolicies, error) {
	policies := model.CommissionPolicies{}
	for _, marketplace := range []model.Marketplace{model.Amazon, model.MercadoLivre, model.Shopee} {
		policy, err := model.NewPercentageCommission(ratesBps[string(marketplace)])
		if err != nil {
			return nil, fmt.Errorf("commission of %s: %w", marketplace, err)
		}
		policies[marketplace] = policy
	}
	return policies, nil
}

// leaveAndClose leaves the consumer group with a time limit first, so that Close does
// not wait on a broker that is down and the process still exits within its budget.
func leaveAndClose(client *kgo.Client) {
	ctx, cancel := context.WithTimeout(context.Background(), leaveGroupTimeout)
	defer cancel()
	_ = client.LeaveGroupContext(ctx)
	client.Close()
}
