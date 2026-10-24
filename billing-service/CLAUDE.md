# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`billing-service` is one service in the "omni-market" monorepo: it turns every confirmed order (`order.order.confirmed.v1`) into one invoice with the Omni Market commission of its marketplace, charges it at a simulated PSP and publishes the outcome (ADR-0005). It is written in Go 1.27 (ADR-0006) with `net/http`, pgx, goose, franz-go and OpenTelemetry.

The bootstrap (#16) delivers the skeleton: config, HTTP server with health check, Postgres with embedded migrations, observability, the outbox with its relay, and a graceful shutdown. The invoice (#23) adds the Kafka consumer of the order events, the `Invoice` aggregate with the commission of each marketplace, and the query API. The payment through the PSP (#32) comes in a later pull request. A manual demo is in `../docs/demo-cobranca.md`. The spec is in `../docs/specs/billing-service/spec.md` (source: `../.specs/features/billing-service/`, with the design and the task plan). The event contracts are in `../docs/eventos.md`.

Shared infrastructure and monorepo-wide conventions are described in `../CLAUDE.md`.

## Commands

Run the commands from this directory:

```bash
make -C .. up-infra                       # infra without the apps: billing-db (:5435), Kafka, OTel collector (:4318), Grafana (:3000), etc.
cp .env.example .env && set -a && . ./.env && set +a   # the service reads the environment only; it does not load .env itself
go run ./cmd/billing-service              # run on PORT (8086)
go build ./... && go vet ./...            # compile and vet
test -z "$(gofmt -l .)"                   # formatting
golangci-lint run                         # v2, config in .golangci.yml
go test ./...                             # all tests; Docker must be running (Testcontainers Postgres)
go test -race ./...                       # what CI runs
go test -run TestRelay ./internal/infra/outbox/   # tests matching a name, in one package
```

Config comes from env vars (see `.env.example`):

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `8086` | 1 to 65535 |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`; applies to the console and to the collector |
| `OTEL_SERVICE_NAME` | `billing-service` | `service.name` of the telemetry |
| `OTEL_COLLECTOR_URL` | `http://localhost:4318` | base URL of the OTLP/HTTP collector |
| `DATABASE_URL` | none, required | `postgresql://billing:billing@localhost:5435/billing` for local runs; the compose file sets it |
| `KAFKA_BROKERS` | `localhost:9092` | comma-separated; inside a compose container `kafka:19092` |
| `OUTBOX_POLL_INTERVAL` | `1s` | how often the relay looks for pending events |
| `KAFKA_CONSUMER_GROUP` | `billing-service` | consumer group of the order events |
| `ORDER_CONFIRMED_TOPIC` | `order.order.confirmed.v1` | confirmed orders, the trigger of the invoice |
| `ORDER_CANCELLED_TOPIC` | `order.order.cancelled.v1` | cancelled orders |
| `ORDER_EVENTS_DLQ_TOPIC` | `billing.order-events.dlq` | messages that can never be processed |
| `COMMISSION_AMAZON_PERCENT` | `12` | commission of the marketplace, 0 to 100 with at most two decimals |
| `COMMISSION_MERCADO_LIVRE_PERCENT` | `11` | idem |
| `COMMISSION_SHOPEE_PERCENT` | `14` | idem |

An invalid variable stops the service with a non-zero status and an error that names the variable, never its value (`DATABASE_URL` carries a password).

Migrations (goose, SQL files in `internal/infra/persistence/migrations/`, embedded in the binary):

- The service applies the pending migrations on startup, before it listens, under a Postgres advisory lock so two instances that start together do not migrate at once. A failed migration ends the process, so the service never runs on an old schema.
- Name files `NNNNN_description.sql` with `-- +goose Up` and `-- +goose Down`. Deploys are rolling, so the old version keeps running on the new schema: write backward-compatible migrations (expand/contract).
- Existing tables: `outbox` (ADR-0002, read by the relay), `processed_events` (inbox: one row per consumed event id), `invoices` and `invoice_items` (one invoice per order, enforced by a unique `order_id`; optimistic lock in `version`) and `order_cancellations` (orders cancelled before their confirmation arrived).

## Architecture: Hexagonal (Ports and Adapters)

`core` is the hexagon: business rules plus the ports that define how the outside world talks to it. `infra` holds the adapters that plug technology into those ports.

```
cmd/billing-service/             process entry: config, telemetry, signals, the `healthcheck` subcommand
internal/
  app/                           composition root (app.Run): migrations, pool, Kafka clients, use cases, order consumer, HTTP server, relay
  core/                          the hexagon, standard library only
    shared/domain/               error categories, AggregateRoot, DomainEvent
    architecture_test.go         fails if core imports anything but the standard library or core packages
    invoice/                     the Invoice aggregate: model/ (Money, Item, Marketplace, commission), port/in/, port/out/, facade.go
  infra/                         adapters, grouped by technology
    config/                      env loading and validation (config.FromEnv)
    observability/               OTLP/HTTP traces, metrics and logs (observability.Setup)
    persistence/                 pgx pool, unit of work, migrations, repositories (invoice, order cancellation, inbox)
    httpapi/                     router, health check, problem details
    outbox/                      Store, Relay and the Kafka producer adapter
    messaging/                   franz-go clients, order event parser and handler, consumer, dead letter, integration event mapper
    system/                      id generator and clock
  testsupport/                   one Testcontainers Postgres per test binary, for the integration tests
```

- Dependencies point inward only. `core` never imports `net/http`-based code, a driver, OpenTelemetry or anything in `infra`; `internal/core/architecture_test.go` enforces it.
- Use cases are plain structs behind `port/in` interfaces and receive their `port/out` dependencies through the constructor. Handlers depend on `port/in`, not on the facade.
- Core errors wrap one of the categories of `core/shared/domain` (`ValidationError`, `NotFoundError`, `ConflictError`) and are found with `errors.As`. `httpapi` maps them to `application/problem+json`: 422, 404 and 409, a malformed request to 400, and any other error to 500 without its message.
- Unit of work: `persistence.Database.WithinTransaction(ctx, fn)` carries the transaction in the context. Repositories get a `Querier` from `db.Querier(ctx)`, which is the open transaction or the pool, and a nested call joins the outer transaction. Ports of the core therefore take no transaction type.
- Money is held in integer cents in the core and written to JSON as a number with two decimals, never as a float.
- Tests sit next to the code (`foo.go` and `foo_test.go`). Unit-test the core with in-memory fakes of the ports, handlers with `httptest`, persistence and the outbox against the real Postgres of `internal/testsupport`, and Kafka against `kfake`, the in-memory cluster of franz-go (no container).
- Follow Go idioms and Clean Code: wrap errors with `%w`, small intention-revealing names, single responsibility, no comments that restate the code.

## Health check

`GET /health` pings Postgres with a 2 s timeout: `200 {"status":"UP"}`, or `503 {"status":"DOWN"}` with a `warn` log, even when the probe ignores its context. It does not check Kafka: a Kafka outage only delays publishing, because events wait in the outbox, and the Kafka client connects lazily, so the service also starts without a broker.

The runtime image has no shell and no curl, so the binary checks itself: `billing-service healthcheck` calls `/health` on `PORT` and exits 0 or 1. The Dockerfile `HEALTHCHECK` runs it.

## Observability

- `observability.Setup` runs in `main` before anything else. It exports traces, metrics (every 60 s) and logs over OTLP/HTTP to `OTEL_COLLECTOR_URL`, sets the global providers and the W3C propagator, and builds the logger: JSON on stdout plus the `otelslog` bridge to the collector, so records carry the trace ids. The exporters connect lazily: a collector that is down does not stop the service, and export failures are logged to the console only.
- Use the `*slog.Logger` that `app.Run` receives and pass the context (`InfoContext`) so a record joins its trace. Custom metrics and spans live in `infra`, never in `core`.
- Shutdown: on `SIGTERM` or `SIGINT`, `app.Run` stops the HTTP server and lets the relay finish its batch, waiting at most `app.ShutdownTimeout` (7 s); `main` then flushes the telemetry for at most 2 s. The process exits within 10 s with status 0.

## Messaging (Kafka)

Domain events reach Kafka through a transactional outbox (`../docs/adr/0002-outbox-para-eventos-do-catalog-service.md`):

- Aggregates embed `domain.AggregateRoot` and `Record(...)` domain events. The repository saves the aggregate and calls `outbox.Store.Append(ctx, aggregate.PullEvents())` in the same transaction, so an event exists if and only if the transaction commits. If any event has no mapping, nothing is written.
- `Store` stores the integration event, not the domain event. Every event that leaves the service needs a mapping (a `Mapper`, with the public, versioned type such as `billing.invoice.issued.v1`, which is also the topic name). An unmapped event fails the append with `outbox.ErrUnmappedEvent`.
- `Relay` runs every `OUTBOX_POLL_INTERVAL`, takes up to 100 pending rows in `sequence` order with `FOR UPDATE SKIP LOCKED`, publishes them one at a time with `aggregate_id` as the key and CloudEvents binary headers (`ce_specversion`, `ce_id`, `ce_source=/billing-service`, `ce_type`, `ce_subject`, `ce_time`, `content-type`), and marks them published. It stops at the first failure, so the failed event and the later ones stay pending, and it marks what was already sent even during a shutdown. Delivery is at-least-once: a crash between the send and the commit sends the event again.
- Tracing: the outbox saves the active W3C trace context in the `headers` column, the relay restores it as the remote parent, and the `kotel` hooks of the Kafka client start the produce span and inject `traceparent`. Consumers continue the trace from the message headers.
- A new published or consumed topic goes in `../docker/kafka/create-topics.sh`, and a new contract goes in `../docs/eventos.md` first.

## Order events and the invoice

- `messaging.OrderEventsConsumer` reads the confirmed and cancelled topics in one consumer group, with manual commits: an offset advances only after the message was processed or dead-lettered. The record is handled inside a `process` span that continues the trace of the message.
- `messaging.OrderEventHandler` validates the CloudEvents headers and the contract (orderId UUID, known marketplace, items and money read from the JSON text, never as floats) and runs the inbox mark and the use case in one transaction. A broken contract, or a `ValidationError` of the core (such as a declared total that differs from the sum of the items), becomes an `UnprocessableError`: the message goes to `billing.order-events.dlq` with the `dlq-original-topic`, `dlq-original-partition`, `dlq-original-offset` and `dlq-reason` headers. Any other error, including the `ConflictError` of the unique `order_id`, is retried with a delay that starts at 1 s and doubles up to 30 s, and the event stays unmarked so the retry is processed.
- `invoice.Facade.IssueInvoice` creates one invoice per order (`ALREADY_ISSUED` keeps the existing one, `ORDER_CANCELLED` creates none), and `CancelInvoice` cancels an invoice that is `ISSUED` or `PAYMENT_PENDING`, or records the cancellation of an order that has no invoice yet.
- The commission is the total times the rate of the marketplace, rounded half-up to the cent (`model.PercentageCommission`); the net amount is the total minus the commission.
- `GET /invoices/{id}` and `GET /invoices` (filters `orderId`, `status`, `marketplace`; `limit` 1 to 100, default 20; `offset`; newest first) return the invoice with items and amounts, money as JSON numbers with two decimals. Invalid parameters are a 400 that names each one.

## Docker and CI/CD

The `Dockerfile` is multi-stage and cross-compiles with the `TARGETOS` and `TARGETARCH` of buildx, so `linux/amd64` and `linux/arm64` come from the same build without emulation. The runtime stage is `gcr.io/distroless/static:nonroot`: no shell, uid 65532, about 44 MB.

```bash
docker build -t billing-service .
docker buildx build --platform linux/amd64,linux/arm64 .
```

CI/CD: `.github/workflows/billing-service.yml` calls `_go-service.yml` (gofmt, vet, golangci-lint, `go test -race`, and the multi-arch image build without push), on push and on pull requests to `main` and `dev`. A push to `main` also publishes `ghcr.io/<owner>/omni-market-billing-service:{sha,latest}`.
