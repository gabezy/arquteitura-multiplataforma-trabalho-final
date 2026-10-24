# order-service bootstrap Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Spec**: `.specs/features/order-service-bootstrap/spec.md`
**Design**: skipped - the bootstrap copies and adapts `catalog-service` patterns; no new architectural decision
**Status**: Done (Verifier PASS, `validation.md`)

**Granularity (user decision, 2026-10-23):** 8 cohesive tasks, one commit each, instead of one task per file. Each task is one deliverable that works and can be reverted on its own; `Where` names a directory when the deliverable spans several files.

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: none (no `CONTRIBUTING.md`, `AGENTS.md` or coverage threshold; `catalog-service/jest.config.js` has no `coverageThreshold`) - strong defaults applied, with `catalog-service` specs as the floor for style and location.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Config (`infra/config`) | unit | Every default, every env var read, every invalid `PORT` boundary (`0`, `65536`, `abc`), broker list trimming | `order-service/src/infra/config/*.spec.ts` | `npx jest src/infra/config` |
| Core shared domain + architecture rule | unit | `AggregateRoot` record/pull; architecture spec fails on any forbidden import in `src/core/` | `order-service/src/core/**/*.spec.ts` | `npx jest src/core` |
| HTTP (app, error handler, health) | route (supertest, fake dependencies) | Every route in scope: happy path + every listed edge case + error paths; each error category | `order-service/src/infra/http/**/*.spec.ts` | `npx jest src/infra/http` |
| Persistence (migrations, migrator, database check) | integration (Testcontainers `postgres:18-alpine`) | Tables and columns created; re-run applies nothing; migrator failure path; database check up and down | `order-service/src/infra/persistence/*.spec.ts` | `npx jest src/infra/persistence` |
| Messaging (outbox repository, relay) | integration (Testcontainers Postgres + fake producer) | Every Publishing AC (BOOT-31..38) and the two Kafka edge cases | `order-service/src/infra/messaging/*.spec.ts` | `npx jest src/infra/messaging` |
| Composition root, instrumentation, Dockerfile, compose, Makefile | none | Build gate + smoke commands listed in the task (same as `catalog-service`, whose `main.ts` and `instrumentation.ts` are excluded from coverage) | - | build gate + smoke |
| CI workflow | none | Green run on the pushed branch | - | GitHub Actions |
| Docs | none | - | - | - |

## Gate Check Commands

> Generated from codebase - confirm before Execute. No linter is configured in `catalog-service`; `typecheck` is the static gate. Integration specs need Docker running (Testcontainers).

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | After tasks with unit or route tests only | `cd order-service && npx jest <task paths>` |
| Full | After tasks with integration tests | `cd order-service && npm run typecheck && npm test` |
| Build | After phase completion or config/infra-only tasks | `cd order-service && npm run typecheck && npm run test:coverage -- --ci && npm run build && docker build -t order-service .` |

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: Foundation

```
T1 → T2
```

### Phase 2: Persistence and publishing

```
T2 → T3
T3 → T4
T3 → T5
```

### Phase 3: Integration

```
T4 → T6
T5 → T6
T6 → T7
T6 → T8
```

---

## Task Breakdown

### T1: Create the project and env configuration

**What**: Node 22 / TypeScript project for `order-service` (`package.json` with the same scripts and dependency versions as `catalog-service`, `tsconfig.json`, `tsconfig.test.json`, `jest.config.js`, `.gitignore`, `.dockerignore`, `.env.example`) and `src/infra/config/env.ts` with `loadConfig`.
**Where**: `order-service/` (project files) and `order-service/src/infra/config/`
**Depends on**: None
**Reuses**: `catalog-service/package.json`, `tsconfig*.json`, `jest.config.js`, `src/infra/config/env.ts`
**Requirement**: BOOT-09, BOOT-10, BOOT-11, BOOT-12, BOOT-28

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `loadConfig({})` returns `port 8084`, `logLevel info`, `serviceName order-service`, `otelCollectorUrl http://localhost:4318`, `databaseUrl postgresql://orders:orders@localhost:5434/orders`, `kafkaBrokers ['localhost:9092']`
- [x] `PORT` of `abc`, `0` and `65536` throws `Invalid PORT: <value>`; `1` and `65535` are accepted
- [x] `KAFKA_BROKERS='a:1, b:2'` gives `['a:1', 'b:2']`
- [x] `dev`, `start` and `migrate` scripts pass `--env-file-if-exists=.env`
- [x] `.env.example` lists `PORT`, `LOG_LEVEL`, `OTEL_SERVICE_NAME`, `OTEL_COLLECTOR_URL`, `DATABASE_URL`, `KAFKA_BROKERS` with their defaults
- [x] `npm ci` produces a committed `package-lock.json`
- [x] Gate check passes: `cd order-service && npx jest src/infra/config && npm run typecheck`
- [x] Test count: at least 5 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(order): cria o projeto do order-service com configuração por ambiente`

**Status**: ✅ Complete

---

### T2: Add the hexagon base, HTTP app and observability

**What**: `src/core/shared/domain/` base classes (`Entity`, `ValueObject`, `AggregateRoot`, `DomainEvent`, `DomainError` categories, `Id`), an architecture spec for `src/core/`, `src/infra/http/app.ts` (`createApp`) with the `problem+json` error handler, and `src/infra/observability/` (`instrumentation.ts`, `logger.ts`, `trace-context.ts`).
**Where**: `order-service/src/core/shared/domain/`, `order-service/src/infra/http/`, `order-service/src/infra/observability/`
**Depends on**: T1
**Reuses**: the same folders in `catalog-service`; `Price`/`Quantity` and `validate.ts` are not copied (no use yet)
**Requirement**: BOOT-13, BOOT-14, BOOT-18, BOOT-20, BOOT-21

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `AggregateRoot.pullDomainEvents()` returns the recorded events once and then an empty list
- [x] Architecture spec scans every `.ts` file in `src/core/` and fails on an import of `express`, `knex`, `pg`, `pino`, `kafkajs`, `@opentelemetry/*` or `src/infra/`; a planted violation in the spec's own fixture makes it fail
- [x] Error handler: an unknown error gives `500` `application/problem+json` without `detail`; `ValidationError` → `422`, `NotFoundError` → `404`, `ConflictError` → `409`; a 4xx Express error with `expose` keeps its status
- [x] `instrumentation.ts` sets `service.name` from `OTEL_SERVICE_NAME` and exports traces, metrics and logs to `OTEL_COLLECTOR_URL`, with the pino instrumentation enabled
- [x] Gate check passes: `cd order-service && npx jest src/core src/infra/http && npm run typecheck`
- [x] Test count: at least 8 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(order): adiciona a base hexagonal, o app http e a observabilidade`

**Status**: ✅ Complete

---

### T3: Add Knex persistence and the outbox and inbox migrations

**What**: `src/infra/persistence/` with `database.ts`, `migration-source.ts`, `migrate.ts` (exits with code 1 on failure, logs `Database already up to date` when nothing is pending), `knexfile.ts`, and migrations `create_outbox_table` (same columns and index as `catalog-service`) and `create_processed_events_table` (`event_id text` PK, `event_type text not null`, `processed_at timestamptz not null default now()`).
**Where**: `order-service/src/infra/persistence/`
**Depends on**: T2
**Reuses**: `catalog-service/src/infra/persistence/{database,migration-source,migrate}.ts`, `catalog-service/knexfile.ts`, `compliance-service` migration `0001` for `processed_events`
**Requirement**: BOOT-03, BOOT-05

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Against a Testcontainers Postgres, the migrator creates `outbox` and `processed_events` with the specified columns, and a second run applies no migration and logs `Database already up to date`
- [x] Against an unreachable database URL, the migrator logs `Migration failed` and sets exit code 1
- [x] Migration names are recorded without extension (migration source spec)
- [x] Gate check passes: `cd order-service && npm run typecheck && npm test`
- [x] Test count: at least 4 new tests pass (no silent deletions)

**Tests**: integration
**Gate**: full

**Commit**: `feat(order): adiciona persistência com knex e as migrations de outbox e inbox`

**Status**: ✅ Complete

---

### T4: Add the health check with the database probe

**What**: `GET /health` route that calls a database probe (`select 1` with a 2 s timeout) and answers `200 {"status":"UP"}` or `503 {"status":"DOWN"}`, logging the error at `warn` on `DOWN`.
**Where**: `order-service/src/infra/http/health/` and `order-service/src/infra/persistence/database-probe.ts`
**Depends on**: T3
**Reuses**: `catalog-service/src/infra/http/health/health.routes.ts`
**Requirement**: BOOT-06, BOOT-07, BOOT-08

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Route spec with a fake probe: resolving probe → `200 {"status":"UP"}`; rejecting probe → `503 {"status":"DOWN"}` and one `warn` log with the error
- [x] Probe spec: against a Testcontainers Postgres it resolves; against a closed port it rejects; a query that does not settle within 2 s rejects (fake timers or a `pg_sleep(3)` query)
- [x] After the probe rejects, a later call with the database reachable answers `UP` again (no cached state)
- [x] Gate check passes: `cd order-service && npm run typecheck && npm test`
- [x] Test count: at least 5 new tests pass (no silent deletions)

**Tests**: integration
**Gate**: full

**Commit**: `feat(order): adiciona o health check com verificação do banco`

**Status**: ✅ Complete

---

### T5: Add the outbox repository and the Kafka outbox relay

**What**: `src/infra/messaging/kafka.config.ts` (producer only: idempotent, 1 request in flight, 5 retries, client id `order-service`), `integration-event.ts` (mapper type), `src/infra/persistence/knex-outbox.repository.ts` and `src/infra/messaging/outbox-relay.ts` with `ce_source=/order-service`.
**Where**: `order-service/src/infra/messaging/` and `order-service/src/infra/persistence/knex-outbox.repository.ts`
**Depends on**: T3
**Reuses**: `catalog-service/src/infra/messaging/{kafka.config,integration-event,outbox-relay}.ts`, `catalog-service/src/infra/persistence/knex-outbox.repository.ts` and `outbox-relay.spec.ts`
**Requirement**: BOOT-31, BOOT-32, BOOT-33, BOOT-34, BOOT-35, BOOT-36, BOOT-37, BOOT-38

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Repository spec: appended events become rows with mapped `event_type` and `payload`, `event_id`, `aggregate_id`, `occurred_at`, active trace context in `headers`, empty `published_at`; an unmapped event throws and the transaction writes no row
- [x] Relay spec (Testcontainers Postgres, fake producer): pending rows go to the topic named after `event_type`, key `aggregate_id`, value = payload JSON, in `sequence` order, at most 100 per round, then get `published_at`
- [x] Relay spec: each message has exactly `ce_specversion=1.0`, `ce_id`, `ce_source=/order-service`, `ce_type`, `ce_subject`, `ce_time` (ISO-8601) and `content-type=application/json`
- [x] Relay spec: a failing `sendBatch` leaves the rows pending and the next round publishes them; `onError` receives the error
- [x] Relay spec: rows locked by an open transaction are skipped by a concurrent round
- [x] Relay spec: with `intervalMs` 1000 the loop starts the next round only after the previous one ends; `stop()` waits for the running round
- [x] Relay spec: the send runs inside the trace context saved in `headers`
- [x] Gate check passes: `cd order-service && npm run typecheck && npm test`
- [x] Test count: at least 10 new tests pass (no silent deletions)

**Tests**: integration
**Gate**: full

**Commit**: `feat(order): adiciona a publicação de eventos via outbox no kafka`

**Status**: ✅ Complete

---

### T6: Wire the composition root and run the service in the compose

**What**: `src/main.ts` (load config, connect the producer, start the relay every 1000 ms, listen and log `order-service listening`; on `SIGTERM`/`SIGINT` close the server, stop the relay, disconnect the producer, destroy the pool, exit 0; on any startup error exit 1), `src/infra/order-service.factory.ts`, the `Dockerfile` (migrate then `exec node`, non-root user, healthcheck on `/health`), and in the root `docker-compose.yaml` the `order-db` service (Postgres 18, `5434:5432`, `orders`/`orders`/`orders`, healthcheck, volume `order-db-data`) and the `order-service` service (port 8084, `DATABASE_URL` to `order-db`, `KAFKA_BROKERS=kafka:19092`, `OTEL_COLLECTOR_URL=http://otel-collector:4318`, `depends_on` `order-db` healthy and `kafka-init` completed); `order-service` added to `APPS` in the root `Makefile`.
**Where**: `order-service/src/main.ts`, `order-service/Dockerfile`, root `docker-compose.yaml` and `Makefile`
**Depends on**: T4, T5
**Reuses**: `catalog-service/src/main.ts`, `catalog-service/Dockerfile`, the `catalog-db` and `catalog-service` compose services
**Requirement**: BOOT-01, BOOT-02, BOOT-04, BOOT-15, BOOT-16, BOOT-17, BOOT-19, BOOT-29, BOOT-30

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Build gate passes: `cd order-service && npm run typecheck && npm run test:coverage -- --ci && npm run build && docker build -t order-service .`
- [x] Smoke: `make up` → `make ps` shows `order-db` and `order-service` healthy; `curl -s localhost:8084/health` → `{"status":"UP"}`
- [x] Smoke: `docker logs order-service` shows the applied migrations before `order-service listening`; `docker restart order-service` logs `Database already up to date`
- [x] Smoke: inserting an `outbox` row with `event_type=test.bootstrap.v1` into a topic created by hand reaches Kafka within 2 s with the `ce_*` headers, and the row gets `published_at` (the topic is deleted afterwards)
- [x] Smoke: a trace and a log line for `order-service` appear in Grafana (Tempo and Loki) after `GET /health`
- [x] Smoke: `docker stop order-service` → exit code `0`; `docker exec order-service id -u` is not `0`
- [x] Smoke: with Kafka stopped, starting the service exits with code 1 (BOOT-30); `make up-infra` leaves `order-service` out
- [x] Only `main.ts` and `*.factory.ts` instantiate adapters (grep check)

**Tests**: none
**Gate**: build

**Commit**: `feat(order): conecta o composition root e sobe o order-service no compose`

**Status**: ✅ Complete

**Deviations**:

- No `order-service.factory.ts`: there is no domain module to wire yet; `main.ts` builds everything and #20 adds `order.factory.ts`.
- `migrate.ts` also builds a database connection: it is the entry point of the migration process (`SPEC_DEVIATION` marker in the file).
- `instrumentation.ts` no longer calls `process.exit(0)` on `SIGTERM`; `main.ts` owns the exit, so the relay round and the pool close before the process ends (BOOT-16). `catalog-service` still has the race.

**Smoke evidence (2026-10-24)**: `make up` → `order-db` and `order-service` healthy; first start logged `Applied 2 migration(s)` before `order-service listening`, restart logged `Database already up to date`; an `outbox` row reached `test.bootstrap.v1` in 0.89 s with the `ce_*` headers and `traceparent`; `/health` gave `503 DOWN` in 12 ms with `order-db` stopped and `200 UP` after it came back; `docker stop` took 0.31 s with exit code 0; uid 100 and `node` as PID 1; Kafka unreachable at startup → exit 1; `make -n up-infra` scales `order-service` to 0; Tempo has `GET /health` spans for `order-service`; Loki has its logs with `trace_id`, including `Failed to relay outbox messages` while `order-db` was down.

---

### T7: Add the order-service CI workflow

**What**: `.github/workflows/order-service.yml` calling `_node-service.yml` with the `paths` filter for `order-service/**`, the workflow itself and `_node-service.yml`, plus the CD job that pushes `ghcr.io/<owner>/omni-market-order-service` on `main`.
**Where**: `.github/workflows/order-service.yml`
**Depends on**: T6
**Reuses**: `.github/workflows/catalog-service.yml`
**Requirement**: BOOT-22, BOOT-23, BOOT-24

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] The workflow differs from `catalog-service.yml` only in service name, paths and image name
- [x] After the push (with user go-ahead), the `order-service` run on the branch is green and no other service's workflow ran for the order-only commits ([run 40043761679](https://github.com/gabezy/arquteitura-multiplataforma-trabalho-final/actions/runs/40043761679))
- [x] Gate check passes: build gate from T6

**Tests**: none
**Gate**: build

**Commit**: `ci(order): adiciona o pipeline do order-service`

**Status**: ✅ Complete

---

### T8: Document the order-service

**What**: `order-service/CLAUDE.md` (commands, env vars, architecture, messaging and testing rules, following `catalog-service/CLAUDE.md`), the services and components tables of the root `README.md`, the layout and Postgres lines of the root `CLAUDE.md`, and the spec copy in `docs/specs/order-service/bootstrap/spec.md` synced with `.specs/`.
**Where**: `order-service/CLAUDE.md`, root `README.md` and `CLAUDE.md`
**Depends on**: T6
**Reuses**: `catalog-service/CLAUDE.md`
**Requirement**: BOOT-25, BOOT-26, BOOT-27

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] README lists `order-service` (Node.js, TypeScript, Express, 8084) and the components `order-db` (`localhost:5434`, `orders`/`orders`) and `order-service` (`http://localhost:8084`)
- [x] Root `CLAUDE.md` lists `order-service/` and `order-db` on localhost:5434
- [x] `diff .specs/features/order-service-bootstrap/spec.md docs/specs/order-service/bootstrap/spec.md` is empty
- [x] Gate check passes: build gate from T6

**Tests**: none
**Gate**: build

**Commit**: `docs(order): documenta o order-service`

**Status**: ✅ Complete

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3

Phase 1:  T1 ------→ T2
Phase 2:  T3 ------→ T4
          T3 ------→ T5
Phase 3:  T6 ------→ T7
          T6 ------→ T8
```

T6 also depends on T4 and T5 (previous phase). Execution is strictly sequential: T1, T2, T3, T4, T5, T6, T7, T8.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: Project and config | Project files + 1 module (`env.ts`) | ⚠️ Cohesive by user decision |
| T2: Hexagon base, HTTP, observability | 3 folders copied from `catalog-service` | ⚠️ Cohesive by user decision |
| T3: Persistence and migrations | 1 folder | ✅ |
| T4: Health check | 1 route + 1 probe | ✅ |
| T5: Outbox and relay | 1 feature (publishing) | ⚠️ Cohesive by user decision |
| T6: Composition root and compose | Wiring + runtime files | ⚠️ Cohesive by user decision |
| T7: CI workflow | 1 file | ✅ |
| T8: Docs | Docs only | ✅ |

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | - | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T2 | T2 → T3 | ✅ Match |
| T4 | T3 | T3 → T4 | ✅ Match |
| T5 | T3 | T3 → T5 | ✅ Match |
| T6 | T4, T5 | T4 → T6, T5 → T6 | ✅ Match |
| T7 | T6 | T6 → T7 | ✅ Match |
| T8 | T6 | T6 → T8 | ✅ Match |

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | Config | unit | unit | ✅ OK |
| T2 | Core shared + HTTP + observability | unit / route / none | unit | ✅ OK |
| T3 | Persistence | integration | integration | ✅ OK |
| T4 | HTTP + persistence probe | route / integration | integration | ✅ OK |
| T5 | Messaging + persistence | integration | integration | ✅ OK |
| T6 | Composition root, Dockerfile, compose, Makefile | none | none (smoke) | ✅ OK |
| T7 | CI workflow | none | none | ✅ OK |
| T8 | Docs | none | none | ✅ OK |
