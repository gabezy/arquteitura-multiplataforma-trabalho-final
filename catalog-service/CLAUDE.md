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

Config comes from env vars (see `.env.example`; `.env` is loaded if present): `PORT` (8082), `LOG_LEVEL`, `OTEL_SERVICE_NAME`, `OTEL_COLLECTOR_URL` (`http://localhost:8000/otel`, the same default as `bff-gateway`).

TypeScript is pinned to 6.x because `ts-jest` does not support TypeScript 7.

## Architecture: Hexagonal (Ports and Adapters)

This service uses Hexagonal Architecture. `core` is the hexagon: business rules plus the ports that define how the outside world talks to it. `infra` holds the adapters that plug technology into those ports. Code is grouped by domain first, then by role.

```
src/
  core/<domain>/              the hexagon, framework-free
    domain/                   entities and value objects (validate themselves)
    exception/                domain exceptions
    port/in/                  driving ports: use-case interfaces called by the outside world
    port/out/                 driven ports: what the core needs (repositories, other services, publishers)
    usecase/                  implementations of port/in that depend only on port/out
  core/shared/domain/         base classes (Entity, ValueObject) and value objects used by more than one domain
  infra/<domain>/             adapters for that domain
    http/ (+ dto/)            driving adapter: Express router that calls a port/in
    persistence/, client/, …  driven adapters: implementations of port/out
    factory.ts                wires the domain's use cases to its adapters
  infra/http/                 Express app factory (createApp), error handler, health route
  infra/config/               env loading (loadConfig)
  infra/observability/        OpenTelemetry SDK bootstrap and logger
  main.ts                     composition root: builds adapters, injects them into use cases, starts the server
```

Tests are co-located with the code they test: `foo.ts` has its spec in `foo.spec.ts` in the same folder. There is no separate `test/` directory. `tsconfig.json` excludes `*.spec.ts` from the build, and Jest picks them up from `src/`.

- Dependencies point inward only: adapters depend on ports, and `core` never imports Express, pino, OpenTelemetry, DB drivers, or anything in `infra`.
- Use cases are plain classes that implement a `port/in` interface and receive their `port/out` dependencies through the constructor.
- Driving adapters (routers) depend on the `port/in` interface, not on the use-case class. They convert HTTP DTOs to use-case input and back, and hold no business logic.
- Every external need (database, another service, a message broker) is a `port/out` interface in `core` with its implementation in `infra/<domain>`. Swapping technology means writing a new adapter. The core does not change.
- One domain must not reach into another domain's `infra`. Cross-domain calls go through ports.
- Core throws its own domain exceptions. `infra/http/error-handler.ts` translates them into `application/problem+json` responses.
- Tests: unit-test use cases with in-memory fakes of the `port/out` interfaces, and test adapters at their boundary (routers with supertest, persistence against a real store).
- Wire dependencies in `main.ts` (or `infra/<domain>/factory.ts`) and pass them into `createApp`, so tests can build the app with fakes.
- Follow Clean Code: small, intention-revealing names, single responsibility, no comments that restate the code.

## Observability

- `infra/observability/instrumentation.ts` starts the `NodeSDK` and must run before any other module. `dev` and `start` load it with `--require`; never import it from app code.
- Auto-instrumentations cover http, express and pino (fs is disabled). Spans and HTTP/runtime metrics need no code.
- Logs: use the pino `Logger` passed into the app. `instrumentation-pino` adds `trace_id`/`span_id` and sends each record to the collector over OTLP.
- Custom metrics/spans: use `metrics.getMeter(...)` / `trace.getTracer(...)` from `@opentelemetry/api` inside `infra`, never in `core`.
- Tests do not load the SDK, so the API calls are no-ops there.
