# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`order-service` is one service in the "omni-market" monorepo: sales orders from the marketplaces, with stock reservation (ADR-0004) and sales reports. It is a Node.js 22 / TypeScript / Express 5 app (CommonJS output) with OpenTelemetry for traces, metrics and logs. It mirrors the architecture of `catalog-service`.

The bootstrap (#15, spec in `../.specs/features/order-service-bootstrap/`) delivers the skeleton: config, HTTP app with health check, Postgres with migrations, observability and event publishing through the outbox. There is no domain yet: the `Order` aggregate, its API and the Kafka consumers come with #20.

Shared infrastructure and monorepo-wide conventions are described in `../CLAUDE.md`.

## Commands

Run the commands from this directory:

```bash
make -C .. up-infra                       # infra without the apps: order-db (:5434), Kafka, OTel collector (:4318), Grafana (:3000), etc.
npm run dev                               # tsx watch, with instrumentation preloaded
npm run build && npm start                # compile to dist/ and run
npm test                                  # all tests (Jest + ts-jest); Docker must be running (Testcontainers)
npx jest src/infra/http                   # one folder
npx jest -t 'answers 200 UP'              # tests matching a name
npm run typecheck                         # tsc over src, including specs
```

Migrations (Knex, `src/infra/persistence/migrations/`):

```bash
npm run migrate                           # apply pending migrations from src/ (tsx)
npm run migrate:status                    # list applied/pending
npm run migrate:rollback                  # undo the last batch
npm run migrate:make -- create_orders     # new timestamped migration file
npm run migrate:deploy                    # apply from dist/ (used by the Docker image on startup)
```

- `ExtensionlessMigrationSource` records migrations without the extension, so a database migrated from `src/` and from `dist/` stays consistent. Every runner (`migrate.ts`, `knexfile.ts`, specs) must use `createMigrationSource()`.
- The Docker image runs `migrate:deploy` before starting the app, and a failed migration exits with code 1 so the app never starts. Write backward-compatible migrations (expand/contract).
- Existing tables: `outbox` (ADR-0002, read by the relay) and `processed_events` (inbox: one row per consumed event id, for the consumers of #20).

Config comes from env vars (see `.env.example`; `.env` is loaded if present): `PORT` (8084), `LOG_LEVEL` (`info`), `OTEL_SERVICE_NAME` (`order-service`), `OTEL_COLLECTOR_URL` (`http://localhost:4318`), `DATABASE_URL` (`postgresql://orders:orders@localhost:5434/orders`) and `KAFKA_BROKERS` (comma-separated, `localhost:9092`; inside a compose container `kafka:19092`). An invalid `PORT` stops the service at startup.

TypeScript is pinned to 6.x because `ts-jest` does not support TypeScript 7.

## Architecture: Hexagonal (Ports and Adapters)

`core` is the hexagon: business rules plus the ports that define how the outside world talks to it. `infra` holds the adapters that plug technology into those ports.

```
src/
  core/                          the hexagon, framework-free
    <aggregate>/                 e.g. order/ (#20)
      model/                     entities, value objects, domain events and errors (validate themselves)
      port/in/                   driving ports: interfaces called by the outside world
      port/out/                  driven ports: what the core needs (repositories, publishers)
      <aggregate>.facade.ts      application service: implements port/in, depends only on port/out
    shared/domain/               base classes (Entity, AggregateRoot, DomainEvent, DomainError, Id)
    architecture.spec.ts         fails if core imports a framework, a driver or infra
  infra/                         adapters, grouped by technology
    http/                        Express app (createApp), error handler, health route
    persistence/                 Knex connection, migrations, migrator, database probe, outbox repository
    messaging/                   Kafka producer, outbox relay, integration-event mapper type
    config/                      env loading (loadConfig)
    observability/               OpenTelemetry SDK bootstrap, logger, trace context
  main.ts                        composition root: opens resources, starts the relay and the server
```

- Dependencies point inward only. `core` never imports Express, Knex, pg, pino, kafkajs, OpenTelemetry or anything in `infra`; `src/core/architecture.spec.ts` enforces it.
- Facades are plain classes that implement `port/in` interfaces and receive their `port/out` dependencies through the constructor. Controllers depend on `port/in`, not on the facade.
- Core throws its own domain errors, never a bare `Error`. Each one extends a category from `core/shared/domain/domain.error.ts`: `ValidationError` → 422, `NotFoundError` → 404, `ConflictError` → 409 in `application/problem+json`. Express 4xx errors keep their status; anything else is a 500 without the message.
- 4xx errors are logged with only status, type, method and path: body-parser errors carry the raw request body, and a JSON `SyntaxError` message may quote part of it.
- Wire a new aggregate in `infra/<aggregate>.factory.ts` and call it from `main.ts`, so tests can build the app with fakes through `createApp`.
- Tests are co-located (`foo.ts` → `foo.spec.ts`). Unit-test facades with in-memory fakes of `port/out`, routes with supertest and fake dependencies, and persistence and messaging against a throwaway `postgres:18-alpine` started by Testcontainers (the outbox needs `jsonb` and `SKIP LOCKED`).
- Follow Clean Code: small, intention-revealing names, single responsibility, no comments that restate the code.

## Health check

`GET /health` runs `select 1` on Postgres with a 2 s timeout: `200 {"status":"UP"}`, or `503 {"status":"DOWN"}` with a `warn` log. It does not check Kafka: a Kafka outage only delays publishing, since events wait in the outbox. The Dockerfile and the compose use it as the healthcheck.

## Observability

- `infra/observability/instrumentation.ts` starts the `NodeSDK` and must run before any other module. `dev` and `start` load it with `--require`; never import it from app code.
- On `SIGTERM`/`SIGINT` it only flushes the SDK. `main.ts` owns the exit: it closes the server, waits for the relay round, disconnects the producer, destroys the pool and exits with code 0.
- Logs: use the pino `Logger`. `instrumentation-pino` adds `trace_id`/`span_id` and sends each record to the collector. Knex warnings go through pino too (`createDatabaseConnection`), so every line is JSON.
- Custom metrics/spans: use `@opentelemetry/api` inside `infra`, never in `core`.

## Messaging (Kafka)

Domain events reach Kafka through a transactional outbox (`../docs/adr/0002-outbox-para-eventos-do-catalog-service.md`):

- Aggregates extend `AggregateRoot` and `record(...)` domain events. The repository saves the aggregate and appends `pullDomainEvents()` with `KnexOutboxRepository.append(tx, aggregateType, events)` in the same transaction.
- `KnexOutboxRepository` stores the integration event, not the domain event. Every event that leaves the service needs a mapping in `infra/messaging/<aggregate>.integration-events.ts` (public, versioned type such as `order.order.placed.v1`); the mapper throws for an unmapped event, and the transaction writes nothing.
- `OutboxRelay` runs every 1000 ms (one round at a time), takes up to 100 pending rows in `sequence` order with `FOR UPDATE SKIP LOCKED`, publishes each to the topic named after its type with `aggregate_id` as the key and CloudEvents `ce_*` headers (`ce_source=/order-service`), then sets `published_at`. A failed send leaves the rows pending for the next round. Delivery is at-least-once: consumers deduplicate by `ce_id`.
- The relay sends each event inside the trace that recorded it (the outbox `headers` column keeps the W3C trace context).
- The producer is idempotent with one request in flight and 5 retries. The service does not start without Kafka (`producer.connect()` runs before `listen`).
- A new published or consumed topic goes in `../docker/kafka/create-topics.sh`. `order.order.placed.v1` and `order.order.cancelled.v1` are already there (the catalog consumes them).
- Consumers (from #20) are driving adapters: they validate the message, use `processed_events` to skip redeliveries, send messages that can never succeed to a dead letter topic and rethrow anything else so Kafka redelivers it.
