# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`catalog-service` is one service in the "omni-market" monorepo. It is a Node.js 22 / TypeScript / Express 5 app (CommonJS output) with OpenTelemetry for traces, metrics and logs.

Shared infrastructure and monorepo-wide conventions are described in `../CLAUDE.md`.

## Commands

Run the commands from this directory:

```bash
docker compose -f ../compose.yaml up -d   # OTel collector (via Kong on :8000/otel), Grafana, etc.
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

Config comes from env vars (see `.env.example`; `.env` is loaded if present): `PORT` (8082), `LOG_LEVEL`, `OTEL_SERVICE_NAME`, `OTEL_COLLECTOR_URL` (`http://localhost:8000/otel`, the same default as `bff-gateway`).

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

Tests are co-located with the code they test: `foo.ts` has its spec in `foo.spec.ts` in the same folder. There is no separate `test/` directory. `tsconfig.json` excludes `*.spec.ts` from the build, and Jest picks them up from `src/`. `infra/persistence/*.spec.ts` runs against the `catalog-db` Postgres from `../compose.yaml`.

- Dependencies point inward only: adapters depend on ports, and `core` never imports Express, Knex, pino, OpenTelemetry, or anything in `infra`.
- Facades are plain classes that implement one or more `port/in` interfaces and receive their `port/out` dependencies through the constructor.
- Controllers depend on the `port/in` interfaces, not on the facade class. They convert HTTP input to port input and back, always send a response, and hold no business logic. Handlers are arrow-function properties so they can be passed to the router without losing `this`.
- Every external need (database, another service, a message broker) is a `port/out` interface in `core` with its implementation in `infra`. Swapping technology means writing a new adapter. The core does not change.
- Core throws its own domain exceptions. `infra/http/error-handler.ts` translates them into `application/problem+json` responses.
- Tests: unit-test facades with in-memory fakes of the `port/out` interfaces, and test adapters at their boundary (routes with supertest and fake `port/in`, persistence against the real Postgres).
- Wire dependencies in `infra/<aggregate>.factory.ts` and call it from `main.ts`, so tests can build the app with fakes through `createApp`.
- Follow Clean Code: small, intention-revealing names, single responsibility, no comments that restate the code.

## Observability

- `infra/observability/instrumentation.ts` starts the `NodeSDK` and must run before any other module. `dev` and `start` load it with `--require`; never import it from app code.
- Auto-instrumentations cover http, express and pino (fs is disabled). Spans and HTTP/runtime metrics need no code.
- Logs: use the pino `Logger` passed into the app. `instrumentation-pino` adds `trace_id`/`span_id` and sends each record to the collector over OTLP.
- Custom metrics/spans: use `metrics.getMeter(...)` / `trace.getTracer(...)` from `@opentelemetry/api` inside `infra`, never in `core`.
- Tests do not load the SDK, so the API calls are no-ops there.
