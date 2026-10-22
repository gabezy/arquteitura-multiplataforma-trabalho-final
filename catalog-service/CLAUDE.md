# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`catalog-service` is one service in the "omni-market" monorepo. It is a Node.js 22 / TypeScript / Express 5 app (CommonJS output) with OpenTelemetry for traces, metrics and logs.

Shared infrastructure and monorepo-wide conventions are described in `../CLAUDE.md`.

## Commands

Run the commands from this directory:

```bash
make -C .. up-infra                       # infra without the apps: Postgres, Kafka, OTel collector (:4318), Grafana (:3000), etc.
npm run dev                               # tsx watch, with instrumentation preloaded
npm run build && npm start                # compile to dist/ and run
npm test                                  # all tests (Jest + ts-jest)
npx jest src/infra/http/app.spec.ts       # one file
npx jest -t 'returns UP'                  # tests matching a name
npm run typecheck                         # tsc over src, including specs
```

Migrations (Knex, `src/infra/persistence/migrations/`):

```bash
npm run migrate                           # apply pending migrations from src/ (tsx)
npm run migrate:status                    # list applied/pending
npm run migrate:rollback                  # undo the last batch
npm run migrate:make -- create_categories # new timestamped migration file
npm run migrate:deploy                    # apply from dist/ (used by the Docker image on startup)
```

- `ExtensionlessMigrationSource` records migrations without the extension (`20261010132157_create_products_table`, not `.ts`/`.js`), so a database migrated from `src/` and from `dist/` stays consistent. Every runner (`migrate.ts`, `knexfile.ts`, specs) must use `createMigrationSource()`.
- The Docker image runs `migrate:deploy` before starting the app. Deploys are rolling, so the old version keeps running on the new schema: write backward-compatible migrations (expand/contract: add nullable columns; rename or drop a column only after no running version uses it).

Config comes from env vars (see `.env.example`; `.env` is loaded if present): `PORT` (8082), `LOG_LEVEL`, `OTEL_SERVICE_NAME`, `OTEL_COLLECTOR_URL` (`http://localhost:4318`, the same default as `bff-gateway`), `DATABASE_URL`, and Kafka:

- `KAFKA_BROKERS`: comma-separated list, default `localhost:9092`. Inside a compose container use `kafka:19092` (see `../CLAUDE.md`).
- `PRODUTO_ANALISADO_TOPIC` (`produto.analisado.v1`): analysis results consumed from the compliance-service.
- `PRODUCT_ANALYSIS_DLQ_TOPIC` (`catalog.product-analysis.dlq`): analysis messages that can never be processed.
- `ORDER_PLACED_TOPIC` (`order.order.placed.v1`) and `ORDER_CANCELLED_TOPIC` (`order.order.cancelled.v1`): order events that reserve and give back stock (consumer group `catalog-service-order-stock`).
- `ORDER_STOCK_DLQ_TOPIC` (`catalog.order-stock.dlq`): order events that can never be processed.

TypeScript is pinned to 6.x because `ts-jest` does not support TypeScript 7.

## Architecture: Hexagonal (Ports and Adapters)

This service uses Hexagonal Architecture. `core` is the hexagon: business rules plus the ports that define how the outside world talks to it. `infra` holds the adapters that plug technology into those ports.

The service is a single bounded context (Catalog), so there are no "modules" inside it. `core` is grouped by aggregate (`core/product/`, later `core/category/`, …). `infra` is grouped by technology (`http/`, `persistence/`), with a per-aggregate subfolder only where it helps (`infra/http/product/`). If the catalog ever needs modules with their own language and rules, that is a sign of a second bounded context, which belongs in another service.

```
src/
  core/                          the hexagon, framework-free
    <aggregate>/                 e.g. product/
      model/                     entities, value objects, domain events and errors (validate themselves)
      port/in/                   driving ports: interfaces called by the outside world
      port/out/                  driven ports: what the core needs (repositories, other services, publishers)
      <aggregate>.facade.ts      application service: implements port/in, depends only on port/out
    shared/domain/               base classes (Entity, ValueObject) and value objects used by more than one aggregate
  infra/                         adapters, grouped by technology
    http/                        Express app (createApp), error handler, health route
      <aggregate>/               controller + routes: driving adapter that calls port/in
    persistence/                 Knex connection, migrations, repositories implementing port/out
    config/                      env loading (loadConfig)
    observability/               OpenTelemetry SDK bootstrap and logger
    <aggregate>.factory.ts       wires the facade to its adapters and builds the controller
  main.ts                        composition root: opens resources, calls the factories, starts the server
```

Tests are co-located with the code they test: `foo.ts` has its spec in `foo.spec.ts` in the same folder. There is no separate `test/` directory. `tsconfig.json` excludes `*.spec.ts` from the build, and Jest picks them up from `src/`. `infra/persistence/*.spec.ts` runs against an in-memory SQLite. `infra/messaging/outbox-relay.spec.ts` needs a real Postgres (it uses `SKIP LOCKED` and `jsonb`), so it starts a throwaway `postgres:18-alpine` container with Testcontainers: Docker must be running for `npm test`, but `catalog-db` does not.

- Dependencies point inward only: adapters depend on ports, and `core` never imports Express, Knex, pino, OpenTelemetry, or anything in `infra`.
- Facades are plain classes that implement one or more `port/in` interfaces and receive their `port/out` dependencies through the constructor.
- Controllers depend on the `port/in` interfaces, not on the facade class. They convert HTTP input to port input and back, always send a response, and hold no business logic. Handlers are arrow-function properties so they can be passed to the router without losing `this`.
- Every external need (database, another service, a message broker) is a `port/out` interface in `core` with its implementation in `infra`. Swapping technology means writing a new adapter. The core does not change.
- Core throws its own domain errors, never a bare `Error`. Each error extends one category from `core/shared/domain/domain.error.ts`: `ValidationError` (invalid value or invariant), `NotFoundError`, or `ConflictError` (valid operation that clashes with the current state). Aggregate-specific errors live next to the aggregate (`core/product/model/product.errors.ts`).
- `infra/http/error-handler.ts` maps categories, not concrete classes, to `application/problem+json`: `ValidationError` → 422, `NotFoundError` → 404, `ConflictError` → 409, Express 4xx errors such as malformed JSON → their own status, anything else → 500 without the message. A new error needs no handler change.
- Tests: unit-test facades with in-memory fakes of the `port/out` interfaces, and test adapters at their boundary (routes with supertest and fake `port/in`, persistence against the real Postgres).
- Wire dependencies in `infra/<aggregate>.factory.ts` and call it from `main.ts`, so tests can build the app with fakes through `createApp`.
- Follow Clean Code: small, intention-revealing names, single responsibility, no comments that restate the code.

## Observability

- `infra/observability/instrumentation.ts` starts the `NodeSDK` and must run before any other module. `dev` and `start` load it with `--require`; never import it from app code.
- Auto-instrumentations cover http, express and pino (fs is disabled). Spans and HTTP/runtime metrics need no code.
- Logs: use the pino `Logger` passed into the app. `instrumentation-pino` adds `trace_id`/`span_id` and sends each record to the collector over OTLP.
- Custom metrics/spans: use `metrics.getMeter(...)` / `trace.getTracer(...)` from `@opentelemetry/api` inside `infra`, never in `core`.
- Tests do not load the SDK, so the API calls are no-ops there.

## Messaging (Kafka)

Domain events reach Kafka through a transactional outbox (see `../docs/adr/0002-outbox-para-eventos-do-catalog-service.md`):

- Aggregates extend `AggregateRoot` and `record(...)` domain events. The repository saves the aggregate and `pullDomainEvents()` into the `outbox` table in the same transaction. The core never sees Kafka.
- `KnexOutboxRepository` stores the integration event, not the domain event. Every domain event that leaves the service needs a mapping in `infra/messaging/<aggregate>.integration-events.ts` (public, versioned type such as `catalog.product.created.v1`). An unmapped event throws.
- `OutboxRelay` publishes each pending row to the topic named after its public type (one topic per event, e.g. `catalog.product.created.v1`), with `aggregate_id` as the key and CloudEvents `ce_*` headers. Delivery is at-least-once. Order is kept per product within one event type only, not across types.
- A new published event needs its topic in `../docker/kafka/create-topics.sh`.
- Tracing spans the whole flow: the http instrumentation continues the `traceparent` sent by `bff-gateway`, `KnexOutboxRepository` saves the active trace context in the outbox `headers` column, and `OutboxRelay` sends each event inside that context (`infra/observability/trace-context.ts`), so the kafkajs instrumentation parents the send span on the request and injects `traceparent` into the message. Consumers continue it from the message headers automatically.
- Stock: the catalog owns product stock. `StockFacade` (`core/stock/`) debits it on `order.order.placed.v1` and gives it back on `order.order.cancelled.v1`, keeping one `StockReservation` per order so a redelivered event changes nothing. It answers with `catalog.stock.reserved.v1` or `catalog.stock.insufficient.v1` and publishes `catalog.product.stock-changed.v1`. Stock is written only by `KnexStockReservationRepository`, with optimistic locking on `products.version`; `KnexProductRepository.save` keeps the stored stock of an existing product. Demo: `../docs/demo-estoque.md`.
- Consumers are driving adapters: they validate the message with zod, translate it to a `port/in` input, send messages that can never succeed (invalid, or a `DomainError`) to a dead letter topic, and rethrow anything else so Kafka redelivers it.
