// Command billing-service charges the orders the marketplaces confirm.
package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/app"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/config"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/observability"
)

const telemetryFlushTimeout = 2 * time.Second

func main() {
	os.Exit(run(os.Args[1:]))
}

func run(args []string) int {
	if len(args) == 1 && args[0] == "healthcheck" {
		return healthcheck()
	}

	cfg, err := config.FromEnv()
	if err != nil {
		fmt.Fprintln(os.Stderr, "billing-service:", err)
		return 1
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	telemetry, err := observability.Setup(ctx, observability.Options{
		ServiceName:  cfg.ServiceName,
		CollectorURL: cfg.OTelCollectorURL,
		LogLevel:     cfg.LogLevel,
		Stdout:       os.Stdout,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, "billing-service:", err)
		return 1
	}

	runErr := app.Run(ctx, cfg, telemetry.Logger)

	flushCtx, cancel := context.WithTimeout(context.Background(), telemetryFlushTimeout)
	defer cancel()
	_ = telemetry.Shutdown(flushCtx)

	if runErr != nil {
		fmt.Fprintln(os.Stderr, "billing-service:", runErr)
		return 1
	}
	return 0
}

// healthcheck backs the container HEALTHCHECK: the runtime image has no shell or curl.
func healthcheck() int {
	port := 8086
	if raw := os.Getenv("PORT"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			return 1
		}
		port = parsed
	}

	client := http.Client{Timeout: 3 * time.Second}
	response, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/health", port))
	if err != nil {
		return 1
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}
