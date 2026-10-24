# order-service bootstrap Specification

Issue: #15 · Owner: Rodrigo Pretes Maia · Date: 2026-10-23
Copy kept in sync at `docs/specs/order-service/bootstrap/spec.md`; this file is the source.

## Problem Statement

The order-service is in the C4 but has no code, database or pipeline. Issues #20 (orders), #29 (stock) and #31 (reports) all build on it, and the M1 gate (#19) on 24/10 expects the bootstrap with a green CI. This feature delivers a running, observable service with no domain yet. It follows the same hexagonal architecture as `catalog-service` and can already publish events through the transactional outbox (ADR-0002), so the domain work can start right away.

## Goals

- [ ] `make up` starts `order-db` and `order-service`, and the container reaches `healthy` with migrations applied.
- [ ] A push that touches `order-service/` runs typecheck, tests, build and the Docker build in CI, and they pass.
- [ ] A row written to `outbox` reaches Kafka on the topic named after its type, in CloudEvents binary mode, with no code beyond the bootstrap.
- [ ] #20 can add the `Order` aggregate without touching config, observability, persistence wiring, event publishing or the pipeline.

## Out of Scope

| Feature | Reason |
| --- | --- |
| `Order` aggregate, order REST API, order events and their integration-event mappings | #20 |
| Kafka consumers, consumer groups, inbox logic and dead letter topics | #20; the `marketplace.order.received.v1` contract is not defined yet (#8, #22) |
| Stock reservation flow | #29 (ADR-0004) |
| Sales reports | #31 |
| Database credentials from Vault | Follow-up after PR #48 merges; this feature uses `DATABASE_URL` like `catalog-service` on `dev` today |
| Infra for billing-service and marketplace-gateway | #14 (@zeciola); this feature only adds the order-service parts |
| Authentication | The BFF is the OAuth2 resource server; internal services do not check tokens (same as `catalog-service`) |
| Outbox cleanup routine, deploy target for CD | Not decided for any service yet (ADR-0002, `catalog-service.yml` TODO) |
| New Kafka topics | `order.order.placed.v1` and `order.order.cancelled.v1` already exist in `create-topics.sh`; new ones come with #20 |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Stack | Node.js 22, TypeScript 6, Express 5, Knex + `pg`, pino, OpenTelemetry, Jest, same versions as `catalog-service` | Reuses `_node-service.yml` and the team's known patterns; no new ADR needed (#15) | y |
| Who adds order-service infra | This feature adds `order-db`, the compose service, `APPS` in the Makefile and `.github/workflows/order-service.yml`; #14 is told to skip them | #15 acceptance needs `make up` and green CI | y |
| Tables in the bootstrap | `outbox` (same shape as `catalog-service`, ADR-0002) and `processed_events` (same shape as `compliance-service`) | The relay reads `outbox`; #20 needs `processed_events`; neither depends on the order model | y |
| Kafka in the bootstrap | Publishing side only: producer, `OutboxRelay`, outbox repository, integration-event mapper type, trace context | Contract-independent and copied from `catalog-service`; consumers wait for the #8 contract | y |
| Health check depth | `GET /health` runs `select 1` on Postgres and does not check Kafka | A container whose database is gone must show as unhealthy; a Kafka outage only delays publishing (events stay pending), same as `catalog-service` | y |
| Relay parameters | Polling every 1000 ms, batches of 100 rows, `FOR UPDATE SKIP LOCKED`, producer idempotent with 1 request in flight and 5 retries | Same values as `catalog-service`, already reviewed in ADR-0002 | y |
| Kafka unreachable at startup | The service exits with code 1 | Same as `catalog-service`: `producer.connect()` runs before the server listens; the compose waits for `kafka-init` | y |
| Spec location | `.specs/features/order-service-bootstrap/spec.md` as source, copy in `docs/specs/order-service/bootstrap/spec.md` | Skill scripts read `.specs/`; #15 asks for the spec in `docs/` | y |
| Config source | Env vars, `.env` loaded when present; Vault comes in a follow-up | PR #48 is open and unreviewed | y |
| Database name and user | `orders` / `orders` / `orders` on host port 5434, container `order-db` | `order` is an SQL reserved word and would need quoting in every `psql` session | y |
| Health check timeout | The database check gives up after 2 s and answers `DOWN` | The compose and Dockerfile healthchecks time out at 5 s; a hung connection must not hang the probe | y |
| CI and CD shape | Copy of `catalog-service.yml`: CI on push with `paths` filter, CD pushes `ghcr.io/<owner>/omni-market-order-service` on `main` | Same pattern as the other services; #6 changes the PR trigger for all of them | y |
| Shared code | Copy `core/shared/domain` base classes (including `DomainEvent` and `AggregateRoot`), error handler, logger, instrumentation, trace context, migration source and the outbox relay from `catalog-service` | Each service is self-contained (ADR-0001); there is no shared package | y |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: Service runs in the local environment ⭐ MVP

**User Story**: As a team member, I want `make up` to start the order-service with its own database so that I can build and demo order features on the shared environment.

**Why P1**: #15 acceptance criterion and the base for #20, #29 and #31.

**Acceptance Criteria**:

1. WHEN `make up` runs THEN the compose SHALL start `order-db` (Postgres 18, host port 5434) and `order-service` (host port 8084), with `order-service` starting only after `order-db` is healthy and `kafka-init` has completed.  <!-- event-driven -->
2. WHEN the `order-service` container starts THEN the service SHALL apply every pending Knex migration before it listens on its port.  <!-- event-driven -->
3. IF a migration fails THEN the service SHALL exit with code 1 without listening on its port.  <!-- unwanted -->
4. WHEN `make up-infra` runs THEN the compose SHALL start `order-db` and SHALL NOT start `order-service`.  <!-- event-driven -->
5. WHEN the service starts a second time on a migrated database THEN the service SHALL apply no migration and SHALL log `Database already up to date`.  <!-- event-driven -->

**Independent Test**: `make up`, then `make ps` shows `order-service` as `healthy` and `docker exec order-db psql -U orders -d orders -c '\dt'` lists `knex_migrations`, `outbox` and `processed_events`.

---

### P1: Health check reflects the database ⭐ MVP

**User Story**: As the operator of the environment, I want the health endpoint to report the database state so that a container that lost its database shows as unhealthy.

**Why P1**: The compose and Dockerfile healthchecks rely on it.

**Acceptance Criteria**:

1. WHEN `GET /health` is called and `select 1` succeeds THEN the service SHALL respond `200` with body `{"status":"UP"}`.  <!-- event-driven -->
2. IF `select 1` fails or takes longer than 2 s THEN `GET /health` SHALL respond `503` with body `{"status":"DOWN"}`.  <!-- unwanted -->
3. IF `GET /health` answers `DOWN` THEN the service SHALL log the database error at `warn` level.  <!-- unwanted -->

**Independent Test**: with the service running, `docker stop order-db` and `curl -i localhost:8084/health` returns `503 {"status":"DOWN"}`; `docker start order-db` and it returns `200 {"status":"UP"}`.

---

### P1: Configuration from environment variables ⭐ MVP

**User Story**: As a developer, I want the service configured by env vars with local defaults so that it runs both in the compose network and from the source with `npm run dev`.

**Why P1**: #15 task; the compose and the host need different addresses.

**Acceptance Criteria**:

1. WHERE an env var is not set the service SHALL use these defaults: `PORT=8084`, `LOG_LEVEL=info`, `OTEL_SERVICE_NAME=order-service`, `OTEL_COLLECTOR_URL=http://localhost:4318`, `DATABASE_URL=postgresql://orders:orders@localhost:5434/orders`, `KAFKA_BROKERS=localhost:9092`.  <!-- optional-feature -->
5. WHEN `KAFKA_BROKERS` holds a comma-separated list THEN the service SHALL use each entry, trimmed of spaces, as a broker address.  <!-- event-driven -->
2. IF `PORT` is not an integer between 1 and 65535 THEN the service SHALL fail at startup with the message `Invalid PORT: <value>` and exit with code 1.  <!-- unwanted -->
3. WHERE a `.env` file exists in `order-service/` the `dev`, `start` and `migrate` scripts SHALL load it.  <!-- optional-feature -->
4. The repository SHALL contain `order-service/.env.example` listing every env var the service reads, with its default value.  <!-- ubiquitous -->

**Independent Test**: `PORT=abc npm start` exits with code 1 and logs `Invalid PORT: abc`; without env vars, `npm run dev` listens on 8084 against `localhost:5434`.

---

### P1: Observability ⭐ MVP

**User Story**: As a team member, I want the service's traces and logs in Grafana so that order flows can be followed end to end like the catalog ones.

**Why P1**: #15 task; the end-to-end Grafana dashboard (#36) depends on it.

**Acceptance Criteria**:

1. WHEN the service handles an HTTP request THEN the service SHALL export a span with `service.name=order-service` to `OTEL_COLLECTOR_URL` over OTLP HTTP.  <!-- event-driven -->
2. WHEN the service writes a log record inside a request THEN the record SHALL carry the request's `trace_id` and `span_id` and SHALL be exported to `OTEL_COLLECTOR_URL` over OTLP HTTP.  <!-- event-driven -->
3. WHEN the service starts listening THEN the service SHALL log `order-service listening` with the port at `info` level.  <!-- event-driven -->

**Independent Test**: call `GET /health`, then find a trace with service `order-service` in Grafana → Tempo and its log line in Grafana → Loki.

---

### P1: Graceful shutdown ⭐ MVP

**User Story**: As the operator, I want the service to stop cleanly on `docker stop` so that no connection is left open on the database.

**Why P1**: Same behavior as the other services; #20 adds consumers that depend on it.

**Acceptance Criteria**:

1. WHEN the process receives `SIGTERM` or `SIGINT` THEN the service SHALL stop accepting HTTP connections, wait for the running relay round to end, disconnect the Kafka producer, close the database pool and exit with code 0.  <!-- event-driven -->
2. The Docker image SHALL run the Node process as PID 1 under a non-root user.  <!-- ubiquitous -->

**Independent Test**: `docker stop order-service` finishes before the 10 s kill timeout and `docker inspect -f '{{.State.ExitCode}}' order-service` prints `0`.

---

### P1: Hexagonal structure ⭐ MVP

**User Story**: As the developer of #20, I want the `core`/`infra` structure and composition root in place so that I only add the domain and its adapters.

**Why P1**: #15 task; Clean Architecture is a monorepo convention.

**Acceptance Criteria**:

1. The code in `order-service/src/core/` SHALL NOT import `express`, `knex`, `pg`, `pino`, `kafkajs`, any `@opentelemetry/*` package or any module under `src/infra/`.  <!-- ubiquitous -->
2. The service SHALL build its dependencies only in `src/main.ts` and in `src/infra/*.factory.ts` files.  <!-- ubiquitous -->
3. IF a request handler throws an error that is not a `DomainError` or a 4xx Express error THEN the service SHALL respond `500` with `application/problem+json` and no `detail`.  <!-- unwanted -->
4. IF a request handler throws a `ValidationError`, `NotFoundError` or `ConflictError` THEN the service SHALL respond `422`, `404` or `409` respectively, with `application/problem+json`.  <!-- unwanted -->

**Independent Test**: the architecture spec fails if a file in `src/core/` imports a forbidden module; the error handler spec covers the four error categories.

---

### P1: Event publishing through the outbox ⭐ MVP

**User Story**: As the developer of #20, I want events recorded by an aggregate to reach Kafka through the transactional outbox so that publishing an order event only needs its domain event and its mapping.

**Why P1**: #20 publishes order events via outbox (ADR-0002); delivering the generic part here keeps #20 on the domain.

**Acceptance Criteria**:

1. WHEN the service starts THEN the service SHALL connect the Kafka producer before it listens on its port.  <!-- event-driven -->
2. IF the Kafka producer cannot connect at startup THEN the service SHALL exit with code 1.  <!-- unwanted -->
3. WHEN domain events are appended to the outbox inside a database transaction THEN the outbox repository SHALL store one row per event with the mapped public type in `event_type`, the mapped data in `payload`, the event id in `event_id`, the aggregate id in `aggregate_id`, the event time in `occurred_at`, the active W3C trace context in `headers` and `published_at` empty.  <!-- event-driven -->
4. IF a domain event has no integration-event mapping THEN the outbox repository SHALL throw and the transaction SHALL write no row.  <!-- unwanted -->
5. WHEN a relay round finds rows with empty `published_at` THEN the relay SHALL send up to 100 of them, in `sequence` order, each to the topic named after its `event_type`, with `aggregate_id` as the key and the `payload` JSON as the value, and SHALL then set their `published_at`.  <!-- event-driven -->
6. WHEN the relay sends a row THEN the message SHALL carry the headers `ce_specversion=1.0`, `ce_id=<event_id>`, `ce_source=/order-service`, `ce_type=<event_type>`, `ce_subject=<aggregate_id>`, `ce_time=<occurred_at ISO-8601>` and `content-type=application/json`.  <!-- event-driven -->
7. IF a send fails THEN the relay SHALL leave the round's rows with empty `published_at`, log `Failed to relay outbox messages` at `error` level and retry them in the next round.  <!-- unwanted -->
8. WHILE a relay round holds rows locked THEN another relay round SHALL skip those rows.  <!-- state-driven -->
9. WHILE the service is running the relay SHALL start a new round 1000 ms after the previous round ends.  <!-- state-driven -->
10. WHEN the relay sends a row THEN the send span SHALL belong to the trace saved in the row's `headers`.  <!-- event-driven -->

**Independent Test**: with the service running, insert a row into `outbox` with `event_type=order.order.placed.v1`; within 2 s the message shows in Kafka UI on `order.order.placed.v1` with the `ce_*` headers and the row has `published_at` set.

---

### P1: Continuous integration ⭐ MVP

**User Story**: As a reviewer, I want every order-service change checked in CI so that a broken build never reaches `dev`.

**Why P1**: #15 acceptance criterion.

**Acceptance Criteria**:

1. WHEN a push changes a file under `order-service/`, `.github/workflows/order-service.yml` or `.github/workflows/_node-service.yml` THEN GitHub Actions SHALL run the `order-service` workflow with typecheck, tests with coverage, build and Docker image build.  <!-- event-driven -->
2. WHEN a push changes only files outside those paths THEN GitHub Actions SHALL NOT run the `order-service` workflow.  <!-- event-driven -->
3. WHEN a push to `main` passes CI THEN the workflow SHALL push the image `ghcr.io/<owner>/omni-market-order-service` tagged with the commit SHA and `latest`.  <!-- event-driven -->

**Independent Test**: the push of this branch shows a green `order-service` run in the Actions tab, and no other service's workflow runs for it.

---

### P2: Documentation

**User Story**: As a team member, I want the service documented where the others are so that anyone can run and extend it.

**Why P2**: #15 task; does not block running the service.

**Acceptance Criteria**:

1. The repository SHALL contain `order-service/CLAUDE.md` with the commands, env vars, architecture and testing rules of the service.  <!-- ubiquitous -->
2. The root `README.md` SHALL list `order-service` (Node.js/TypeScript/Express, port 8084) in the services table and `order-db` (`localhost:5434`, `orders`/`orders`) and `order-service` (`http://localhost:8084`) in the components table.  <!-- ubiquitous -->
3. The root `CLAUDE.md` SHALL list `order-service/` in the monorepo layout and `order-db` in the Postgres line.  <!-- ubiquitous -->

**Independent Test**: read the three files.

---

## Edge Cases

- IF `order-db` is not reachable when the container starts THEN the migration step SHALL fail and the service SHALL exit with code 1 (covered by P1 run AC-3; the compose `depends_on` makes this rare).
- IF two service instances start at once on the same database THEN Knex's migration lock SHALL let only one apply the migrations.
- WHEN the database comes back after an outage THEN `GET /health` SHALL answer `UP` again without restarting the service.
- IF Kafka goes down while the service runs THEN the events SHALL stay pending in `outbox` and SHALL be published once Kafka is back, with no restart.
- IF the relay sends a batch and crashes before setting `published_at` THEN the next round SHALL send those rows again (at-least-once; consumers deduplicate by `ce_id`).

### Implicit-requirement sweep

| Dimension | Coverage |
| --- | --- |
| Input validation & bounds | Config: `PORT` (Configuration AC-2). No user input yet: N/A because the service has no business endpoint |
| Failure / partial-failure states | Migration failure (Run AC-3), database down (Health AC-2) |
| Idempotency / retry / duplicate handling | Migrations re-run safely (Run AC-5); failed sends retried (Publishing AC-7); idempotent producer; at-least-once (Edge Cases); `processed_events` ready for #20. N/A for incoming messages: no consumer yet |
| Auth boundaries & rate limits | N/A because the BFF is the only entry point with auth (Out of Scope) |
| Concurrency / ordering | Migration lock (Edge Cases); outbox `sequence` order and `SKIP LOCKED` (Publishing AC-5, AC-8) |
| Data lifecycle / expiry | N/A because outbox cleanup is out of scope for every service |
| Observability | Observability story; publication joins the recording trace (Publishing AC-10) |
| External-dependency failure | Database: Health AC-2 and Edge Cases. Kafka: startup (Publishing AC-2), outage while running (Edge Cases) |
| State-transition integrity | N/A because there is no aggregate yet |

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| BOOT-01 | P1: Service runs - compose starts `order-db` and `order-service` | T6 | Implementing |
| BOOT-02 | P1: Service runs - migrations before listening | T6 | Implementing |
| BOOT-03 | P1: Service runs - failed migration exits 1 | T3 | Implementing |
| BOOT-04 | P1: Service runs - `make up-infra` leaves the service out | T6 | Implementing |
| BOOT-05 | P1: Service runs - second start applies nothing | T3 | Implementing |
| BOOT-06 | P1: Health - `UP` with the database | T4 | Implementing |
| BOOT-07 | P1: Health - `DOWN` within 2 s without the database | T4 | Implementing |
| BOOT-08 | P1: Health - `DOWN` is logged | T4 | Implementing |
| BOOT-09 | P1: Configuration - defaults | T1 | Implementing |
| BOOT-10 | P1: Configuration - invalid `PORT` | T1 | Implementing |
| BOOT-11 | P1: Configuration - `.env` loaded | T1 | Implementing |
| BOOT-12 | P1: Configuration - `.env.example` | T1 | Implementing |
| BOOT-13 | P1: Observability - spans exported | T2 | Implementing |
| BOOT-14 | P1: Observability - logs with trace context | T2 | Implementing |
| BOOT-15 | P1: Observability - startup log | T6 | Implementing |
| BOOT-16 | P1: Graceful shutdown - exit 0 on signal | T6 | Implementing |
| BOOT-17 | P1: Graceful shutdown - PID 1, non-root | T6 | Implementing |
| BOOT-18 | P1: Hexagonal - `core` framework-free | T2 | Implementing |
| BOOT-19 | P1: Hexagonal - wiring in composition root | T6 | Implementing |
| BOOT-20 | P1: Hexagonal - unhandled error is 500 | T2 | Implementing |
| BOOT-21 | P1: Hexagonal - domain errors mapped | T2 | Implementing |
| BOOT-22 | P1: CI - runs on order-service changes | T7 | In Tasks |
| BOOT-23 | P1: CI - skipped for other paths | T7 | In Tasks |
| BOOT-24 | P1: CI - CD image on `main` | T7 | In Tasks |
| BOOT-25 | P2: Docs - `order-service/CLAUDE.md` | T8 | In Tasks |
| BOOT-26 | P2: Docs - root README tables | T8 | In Tasks |
| BOOT-27 | P2: Docs - root CLAUDE.md | T8 | In Tasks |
| BOOT-28 | P1: Configuration - `KAFKA_BROKERS` list | T1 | Implementing |
| BOOT-29 | P1: Publishing - producer connects before listening | T6 | Implementing |
| BOOT-30 | P1: Publishing - Kafka unreachable at startup exits 1 | T6 | Implementing |
| BOOT-31 | P1: Publishing - outbox row per event | T5 | Implementing |
| BOOT-32 | P1: Publishing - unmapped event throws | T5 | Implementing |
| BOOT-33 | P1: Publishing - relay sends pending rows in order | T5 | Implementing |
| BOOT-34 | P1: Publishing - CloudEvents headers | T5 | Implementing |
| BOOT-35 | P1: Publishing - failed send stays pending | T5 | Implementing |
| BOOT-36 | P1: Publishing - `SKIP LOCKED` | T5 | Implementing |
| BOOT-37 | P1: Publishing - 1000 ms polling | T5 | Implementing |
| BOOT-38 | P1: Publishing - send span in the recording trace | T5 | Implementing |

**Coverage:** 38 total, 38 mapped to tasks, 0 unmapped; 32 implemented

---

## Success Criteria

- [ ] `make up` from a clean state (`make clean`) brings `order-service` to `healthy` with no manual step.
- [ ] The first CI run of `order-service` on this branch is green.
- [ ] A row inserted by hand into `outbox` shows up in Kafka UI within 2 s.
- [ ] #20 starts by adding `src/core/order/` with no change to `main.ts` other than registering its factory.
