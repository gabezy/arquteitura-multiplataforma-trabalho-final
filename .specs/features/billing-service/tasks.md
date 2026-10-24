# billing-service Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Spec**: `.specs/features/billing-service/spec.md`
**Design**: `.specs/features/billing-service/design.md`
**Status**: Approved (2026-10-24)

**Granularity:** cohesive tasks, one commit each, as in `.specs/features/order-service-bootstrap/tasks.md`. Each task is one deliverable that builds, passes its gate and can be reverted alone; `Where` names a directory when the deliverable spans several files of one package.

**Branches and pull requests (all to `dev`, merged in order):** Phase 1 on `feature/11-escopo-cobranca` (from `dev`), Phase 2 on `feature/16-bootstrap-billing-service`, Phase 3 on `feature/23-cobranca-a-partir-do-pedido`, Phase 4 on `feature/32-pagamento-psp`, each stacked on the previous one so that `.specs/features/billing-service/` exists on every branch. Until a pull request is merged, the next one also shows its commits. The last task of each phase syncs the spec copy in `docs/specs/billing-service/spec.md`.

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `catalog-service/CLAUDE.md`, `compliance-service/CLAUDE.md`, `order-service/CLAUDE.md` (unit tests with fakes of the ports, adapters tested at their boundary, persistence against a real Postgres with Testcontainers), `.github/workflows/_python-service.yml` and `_node-service.yml` (lint + tests + Docker build). No coverage threshold is configured.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Core model and facade | unit | All branches; 1:1 to spec ACs; every listed edge case | `billing-service/internal/core/**/*_test.go` | `go test ./internal/core/...` |
| Config and observability | unit | Defaults, every invalid value named without its value, telemetry received by a fake collector | `billing-service/internal/infra/{config,observability}/*_test.go` | `go test ./internal/infra/config/... ./internal/infra/observability/...` |
| Persistence and outbox | integration (Testcontainers Postgres) | Key query paths, locking, idempotency and error paths | `billing-service/internal/infra/{persistence,outbox}/*_test.go` | `go test ./internal/infra/persistence/... ./internal/infra/outbox/...` |
| Messaging (consumer, mapping, CloudEvents) | unit (fake facade, fake inbox, fake producer) | Every consumer AC: happy, duplicate, DLQ, transient retry | `billing-service/internal/infra/messaging/*_test.go` | `go test ./internal/infra/messaging/...` |
| HTTP handlers | unit (`httptest`, fake ports) | All routes: happy + edge + error | `billing-service/internal/infra/http/*_test.go` | `go test ./internal/infra/http/...` |
| PSP adapter | integration (WireMock container with the real mappings) + unit (`httptest` faults) | Approved, refused, status query, timeout, 5xx, circuit open | `billing-service/internal/infra/psp/*_test.go` | `go test ./internal/infra/psp/...` |
| Workers | unit (fake facade, short intervals) | Drains due work, stops when the PSP is unavailable, stops on cancel | `billing-service/internal/infra/worker/*_test.go` | `go test ./internal/infra/worker/...` |
| Composition root | integration (Testcontainers Postgres and Kafka) | Starts, answers health, issues an invoice from a Kafka event, stops within 10 s | `billing-service/internal/app/*_test.go` | `go test ./internal/app/...` |
| Docker, compose, CI, docs | none | Build gate only | - | build or docs gate |

## Gate Check Commands

> Generated from codebase - confirm before Execute. Commands run from `billing-service/` unless noted.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Tasks with unit tests only | `go vet ./... && go test ./internal/core/... ./internal/infra/config/... ./internal/infra/http/... ./internal/infra/messaging/... ./internal/infra/worker/...` |
| Full | Tasks with integration tests | `go vet ./... && go test ./...` (Docker running) |
| Build | Phase completion and Docker, compose or CI tasks | `test -z "$(gofmt -l .)" && go vet ./... && golangci-lint run && go test -race ./... && docker build .` |
| Docs | Documentation-only tasks (from the repository root) | `git diff --check && python3 <skill-dir>/scripts/validate_spec.py .specs/features/billing-service/spec.md` |

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: Billing scope (#11)

```
T1 → T2
```

### Phase 2: Bootstrap (#16)

```
T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10 → T11
```

### Phase 3: Invoice from the order (#23)

```
T12 → T13 → T14 → T15 → T16 → T17
```

### Phase 4: Payment through the PSP (#32)

```
T18 → T19 → T20 → T21 → T22 → T23
```

---

## Task Breakdown

### Phase 1: Billing scope (#11)

#### T1: ADR-0005, scope of the billing

**What**: ADR that records what is charged (confirmed order total through the PSP, commission per marketplace on the invoice), from whom and when, with at least three alternatives.
**Where**: `docs/adr/0005-escopo-da-cobranca.md`
**Depends on**: None
**Reuses**: format of `docs/adr/0002-outbox-para-eventos-do-catalog-service.md` and `docs/adr/0004-...`
**Requirement**: DOC-01

**Tools**:

- MCP: NONE
- Skill: `adr`

**Done when**:

- [x] Status `Proposto`, date, author, context bullets with project facts
- [x] Four alternatives (order + commission, order only, commission from the store, monthly fee) with trade-offs
- [x] At least one honest negative consequence and two references with author and source
- [x] Gate check passes: docs gate

**Tests**: none
**Gate**: docs

**Commit**: `docs(billing): adiciona ADR-0005 com o escopo da cobrança`

---

#### T2: Event catalog and PSP contract

**What**: The billing contracts in the event catalog of #8 (`docs/eventos.md`, written by Natan in PR #52): the order events billing consumes (`order.order.confirmed.v1`, `order.order.cancelled.v1`), the three billing events, the billing DLQ, and the PSP contract (charge, webhook, status query). The billing sections were aligned to ADR-0005 in commits on that PR.
**Where**: `docs/eventos.md` (branch of #8)
**Depends on**: T1
**Reuses**: contracts in `.specs/features/billing-service/design.md`, conventions listed in issue #8
**Requirement**: DOC-02, DOC-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Each billing-related topic lists producer, consumers, key, CloudEvent type, JSON example and DLQ
- [x] The PSP section has request and response examples for the three calls
- [x] It says which parts #8 (Natan) still has to fill in
- [x] Gate check passes: docs gate

**Tests**: none
**Gate**: docs

**Commit**: `docs(billing): registra os eventos e o contrato do PSP no catálogo de eventos`

---

### Phase 2: Bootstrap (#16)

#### T3: ADR-0006, Go in the billing-service

**What**: ADR that records the choice of Go for the billing-service, with Python, TypeScript and Java as alternatives.
**Where**: `docs/adr/0006-go-no-billing-service.md`
**Depends on**: None
**Reuses**: ADR-0001 (polyglot monorepo), ADR-0002 (each stack reimplements the relay)
**Requirement**: BOOT-09

**Tools**:

- MCP: NONE
- Skill: `adr`

**Done when**:

- [x] Four alternatives with trade-offs, honest negatives (new reusable workflow, no Go reference in the repo)
- [x] Gate check passes: docs gate

**Tests**: none
**Gate**: docs

**Commit**: `docs(billing): adiciona ADR-0006 com a escolha de Go`

---

#### T4: Go module, configuration, telemetry and core rules

**What**: `go.mod`, `internal/core/shared/domain` (error categories, aggregate root), `internal/infra/config` (environment with defaults and validation), `internal/infra/observability` (OTLP/HTTP traces, metrics and logs; slog), and an architecture test that keeps the core on the standard library.
**Where**: `billing-service/internal/`
**Depends on**: T3
**Reuses**: config variables of `catalog-service/.env.example`; telemetry setup of `compliance-service/src/compliance_service/infra/observability/telemetry.py`
**Requirement**: BOOT-04, BOOT-05, BOOT-09

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] An invalid variable fails with its name and without its value; defaults match the design
- [ ] A span, a metric and a log record reach a fake OTLP collector with `service.name=billing-service`
- [ ] The architecture test fails when a core file imports a non-standard package
- [ ] Gate check passes: quick gate; test count ≥ 10

**Tests**: unit
**Gate**: quick

**Commit**: `feat(billing): cria o módulo Go com configuração, telemetria e regras do core`

---

#### T5: Database pool, transactor and migrations

**What**: pgx pool with the otelpgx tracer, `Transactor` that carries the transaction in the context, goose migrations embedded in the binary with an advisory lock, and migration `0001` (`outbox`, `processed_events`).
**Where**: `billing-service/internal/infra/persistence/`
**Depends on**: T4
**Reuses**: outbox columns of `catalog-service`, `processed_events` of `compliance-service`
**Requirement**: BOOT-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Migrating twice is a no-op; the tables exist afterwards
- [ ] A nested `WithinTransaction` joins the outer transaction; an error rolls everything back
- [ ] Gate check passes: full gate; test count ≥ 4

**Tests**: integration
**Gate**: full

**Commit**: `feat(billing): adiciona pool do Postgres, transações e migrations`

---

#### T6: HTTP server, health check and problem details

**What**: `net/http` server with `otelhttp`, `GET /health` with a 2 s database probe, and the problem details writer that maps domain error categories to status codes.
**Where**: `billing-service/internal/infra/http/`
**Depends on**: T5
**Reuses**: `order-service/src/infra/http/health/health.routes.ts`, `catalog-service/src/infra/http/error-handler.ts`
**Requirement**: BOOT-01, BOOT-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] 200 `{"status":"UP"}` with a healthy probe, 503 `{"status":"DOWN"}` with a failing or slow probe
- [ ] Validation, not found, conflict and unknown errors become 422, 404, 409 and 500 problems; 500 hides the message
- [ ] Gate check passes: quick gate; test count ≥ 6

**Tests**: unit
**Gate**: quick

**Commit**: `feat(billing): adiciona servidor HTTP, health check e problem details`

---

#### T7: Outbox store and relay

**What**: `Store.Append` (maps events, saves the trace context, same transaction) and `Relay.Run` (locks pending rows with `SKIP LOCKED`, produces with CloudEvents headers in `sequence` order, marks them published), plus the franz-go producer adapter.
**Where**: `billing-service/internal/infra/outbox/`
**Depends on**: T6
**Reuses**: `catalog-service/src/infra/messaging/outbox-relay.ts`
**Requirement**: BOOT-10

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Appended events are published in order with key, topic and `ce_*` headers, then marked
- [ ] A producer failure leaves the rows pending; an unmapped event fails the append
- [ ] Gate check passes: full gate; test count ≥ 5

**Tests**: integration
**Gate**: full

**Commit**: `feat(billing): adiciona outbox com relay para o Kafka`

---

#### T8: Composition root and graceful shutdown

**What**: `internal/app.Run` (telemetry, migrations, pool, Kafka client, HTTP server, relay) and `cmd/billing-service/main.go` with SIGTERM handling and the `healthcheck` subcommand.
**Where**: `billing-service/internal/app/`
**Depends on**: T7
**Reuses**: role of `order-service/src/main.ts`
**Requirement**: BOOT-03, BOOT-06

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Started against a Testcontainers Postgres, `/health` answers `UP` and migrations are applied before the server listens
- [ ] Cancelling the context makes `Run` return within 10 s with no error
- [ ] Gate check passes: full gate; test count ≥ 2

**Tests**: integration
**Gate**: full

**Commit**: `feat(billing): conecta o composition root com shutdown gracioso`

---

#### T9: Docker image and compose

**What**: multi-stage, multi-arch `Dockerfile` (distroless, non-root), `.dockerignore`, `.env.example`, `billing-db` (5435) and `billing-service` (8086) in `docker-compose.yaml`, and `billing-service` in `APPS` of the `Makefile`.
**Where**: `billing-service/Dockerfile`
**Depends on**: T8
**Reuses**: compose entries of `order-db` and `order-service`
**Requirement**: BOOT-07

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `docker compose up -d --build billing-db billing-service` brings both to healthy and `curl localhost:8086/health` answers `UP`
- [ ] `docker buildx build --platform linux/amd64,linux/arm64 .` succeeds
- [ ] Gate check passes: build gate

**Tests**: none
**Gate**: build

**Commit**: `feat(billing): adiciona Dockerfile multiplataforma e sobe o serviço no compose`

---

#### T10: CI pipeline

**What**: reusable `_go-service.yml` (gofmt, vet, golangci-lint, tests with race detector and Testcontainers, multi-arch Docker build), `billing-service.yml` with `paths` filters and CD to GHCR on `main`, and `.golangci.yml`.
**Where**: `.github/workflows/`
**Depends on**: T9
**Reuses**: `.github/workflows/_python-service.yml`, `.github/workflows/compliance-service.yml`
**Requirement**: BOOT-08

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Workflows parse as YAML and `golangci-lint run` passes locally
- [ ] After the push, the billing workflow runs green on the branch and the other services' workflows do not run
- [ ] Gate check passes: build gate

**Tests**: none
**Gate**: build

**Commit**: `ci(billing): adiciona pipeline reutilizável de Go e o workflow do billing`

---

#### T11: Service documentation

**What**: `billing-service/CLAUDE.md`, rows in the services and components tables of `README.md`, layout and Postgres lines of the root `CLAUDE.md`, and the spec copy in `docs/specs/billing-service/spec.md`.
**Where**: `billing-service/CLAUDE.md`
**Depends on**: T10
**Reuses**: `order-service/CLAUDE.md`
**Requirement**: BOOT-07

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Commands, environment variables, architecture and testing rules documented
- [ ] `diff .specs/features/billing-service/spec.md docs/specs/billing-service/spec.md` is empty
- [ ] Gate check passes: docs gate

**Tests**: none
**Gate**: docs

**Commit**: `docs(billing): documenta o billing-service no CLAUDE.md e no README`

---

### Phase 3: Invoice from the order (#23)

#### T12: Invoice model

**What**: `Money`, `Marketplace`, `Item`, `CommissionPolicy` with `PercentageCommission` and `CommissionPolicies`, the `Invoice` aggregate (issue, cancel, snapshot, restore) and the `InvoiceIssued` event.
**Where**: `billing-service/internal/core/invoice/model/`
**Depends on**: T11
**Reuses**: error categories from T4
**Requirement**: INV-01, INV-02, INV-08, INV-11

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Total, commission (half-up, including the R$ 0,25 at 14% edge case) and net match the spec
- [ ] Bounds of items, marketplace and a declared total that differs from the sum of the items raise `ValidationError`
- [ ] Cancel changes `ISSUED` and `PAYMENT_PENDING` only
- [ ] Gate check passes: quick gate; test count ≥ 15

**Tests**: unit
**Gate**: quick

**Commit**: `feat(billing): adiciona o agregado de cobrança com comissão por marketplace`

---

#### T13: Invoice facade and ports

**What**: `port/in` (issue, cancel, get, list), `port/out` (repository, cancellations, transactor, ids, clock) and the facade with idempotency by order and the recorded cancellation rule.
**Where**: `billing-service/internal/core/invoice/`
**Depends on**: T12
**Reuses**: facade pattern of `catalog-service/src/core/product/product.facade.ts`
**Requirement**: INV-01, INV-05, INV-08, INV-09, INV-10

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Issue returns `Issued`, `AlreadyIssued` or `OrderCancelled` as the spec says
- [ ] Cancel returns `Cancelled`, `Unchanged` or `Recorded`
- [ ] Get of an unknown id returns `NotFoundError`
- [ ] Gate check passes: quick gate; test count ≥ 10

**Tests**: unit
**Gate**: quick

**Commit**: `feat(billing): adiciona os casos de uso de emissão e cancelamento da cobrança`

---

#### T14: Invoice persistence

**What**: migration `0002` (`invoices`, `invoice_items`, `order_cancellations`), `InvoiceRepository` (save with optimistic version and events to the outbox, find by id and order, filtered list newest first) and `OrderCancellations`.
**Where**: `billing-service/internal/infra/persistence/`
**Depends on**: T13
**Reuses**: transactor and outbox store from T5 and T7
**Requirement**: INV-03, INV-05, INV-09, API-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Save and reload give the same snapshot; a second invoice for the same order fails on the unique key
- [ ] Saving writes the pulled events to the outbox in the same transaction
- [ ] Filters, limit and offset return the expected rows newest first
- [ ] Gate check passes: full gate; test count ≥ 6

**Tests**: integration
**Gate**: full

**Commit**: `feat(billing): adiciona persistência das cobranças`

---

#### T15: Order events consumer and integration events

**What**: CloudEvents parsing and contract validation of the two order events, the consumer (inbox, facade, DLQ, retry 1 s..30 s, commit), the dead letter publisher and the mapping of `InvoiceIssued` to `billing.invoice.issued.v1`.
**Where**: `billing-service/internal/infra/messaging/`
**Depends on**: T14
**Reuses**: `compliance-service` consumer flow, `catalog-service` DLQ headers
**Requirement**: INV-03, INV-04, INV-06, INV-07

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Valid confirmation reaches the facade once; a duplicate `ce_id` does not
- [ ] Each contract violation of INV-06 goes to the DLQ with `dlq-*` headers and the offset is committed
- [ ] A transient error is retried with the backoff sequence and the offset is committed only after success
- [ ] `billing.invoice.issued.v1` payload matches the design, money with two decimals
- [ ] Gate check passes: quick gate; test count ≥ 12

**Tests**: unit
**Gate**: quick

**Commit**: `feat(billing): consome os eventos de pedido com inbox e DLQ`

---

#### T16: Invoice query API

**What**: `GET /invoices/{id}` and `GET /invoices` with filters and pagination, JSON in the design format.
**Where**: `billing-service/internal/infra/http/`
**Depends on**: T15
**Reuses**: problem details from T6
**Requirement**: API-01, API-02, API-03, API-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] 200 with the invoice, 404 for an unknown id, 400 for each invalid parameter
- [ ] Filters and pagination are passed to the port
- [ ] Gate check passes: quick gate; test count ≥ 8

**Tests**: unit
**Gate**: quick

**Commit**: `feat(billing): adiciona API de consulta das cobranças`

---

#### T17: Wiring, topics and demo of the invoice

**What**: wire consumer, facade and API in `internal/app`; commission rates and topics in config; topics in `docker/kafka/create-topics.sh`; demo script `docs/demo-cobranca.md`; updates to `billing-service/CLAUDE.md`.
**Where**: `billing-service/internal/app/`
**Depends on**: T16
**Reuses**: `docs/demo-estoque.md`
**Requirement**: INV-01, INV-03, INV-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] An app test with Testcontainers Kafka and Postgres publishes a confirmation twice and finds one invoice through the API and one `billing.invoice.issued.v1` on Kafka
- [ ] The demo runs against `make up`
- [ ] Gate check passes: build gate; test count ≥ 3 in `internal/app`

**Tests**: integration
**Gate**: build

**Commit**: `feat(billing): emite a cobrança a partir do pedido confirmado`

---

### Phase 4: Payment through the PSP (#32)

#### T18: ADR-0007, PSP integration

**What**: ADR that records the asynchronous charge (payment worker, webhook, reconciliation) with timeout, retry and circuit breaker.
**Where**: `docs/adr/0007-integracao-assincrona-com-o-psp.md`
**Depends on**: T17
**Reuses**: approaches table of the design
**Requirement**: PAY-01

**Tools**:

- MCP: NONE
- Skill: `adr`

**Done when**:

- [ ] Three alternatives with trade-offs, negatives and two references
- [ ] Gate check passes: docs gate

**Tests**: none
**Gate**: docs

**Commit**: `docs(billing): adiciona ADR-0007 da integração assíncrona com o PSP`

---

#### T19: Payment in the model and the facade

**What**: payment transitions and events (`PaymentConfirmed`, `PaymentFailed`) in the aggregate, `PaymentGateway` port, and the use cases `RequestNextPayment`, `ApplyPaymentResult` and `ReconcilePendingPayments`.
**Where**: `billing-service/internal/core/invoice/`
**Depends on**: T18
**Reuses**: model and facade from T12 and T13
**Requirement**: PAY-01, PAY-02, PAY-03, PAY-04, PAY-05, PAY-07, PAY-08, PAY-10, REC-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Every row of the status machine in the design has a test
- [ ] Unavailable PSP increments attempts and schedules min(2^n, 60) s; refused fails the invoice; accepted stores the charge id
- [ ] Repeated outcome is unchanged; contradicting outcome is `ConflictError`
- [ ] Gate check passes: quick gate; test count ≥ 15

**Tests**: unit
**Gate**: quick

**Commit**: `feat(billing): adiciona o pagamento ao agregado e aos casos de uso`

---

#### T20: Payment persistence

**What**: migration `0003` (payment columns and indexes), repository methods `LockNextDue`, `LockByID`, `ListPendingRequestedBefore`, and the mapping of the payment events.
**Where**: `billing-service/internal/infra/persistence/`
**Depends on**: T19
**Reuses**: repository from T14
**Requirement**: PAY-01, REC-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Two concurrent `LockNextDue` never return the same invoice
- [ ] Only due `ISSUED` invoices are returned; only pending ones older than the cut are listed
- [ ] Gate check passes: full gate; test count ≥ 5

**Tests**: integration
**Gate**: full

**Commit**: `feat(billing): persiste o estado do pagamento das cobranças`

---

#### T21: PSP adapter and WireMock mappings

**What**: HTTP adapter for the PSP (create and get charge) with 3 s timeout, 3 attempts with backoff and a circuit breaker, and the WireMock mappings in `docker/wiremock/mappings/psp.json`.
**Where**: `billing-service/internal/infra/psp/`
**Depends on**: T20
**Reuses**: `docker/wiremock/mappings/catalog.json` format
**Requirement**: PAY-05, PAY-09, PAY-11, PAY-12

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Against WireMock with the real mappings: approved, refused (≥ R$ 100.000,00) and status query behave as the design says
- [ ] With `httptest`: timeout and 5xx are retried 3 times; 422 is not retried; 5 failures open the circuit
- [ ] Gate check passes: full gate; test count ≥ 8

**Tests**: integration
**Gate**: full

**Commit**: `feat(billing): adiciona o adapter do PSP com retry e circuit breaker`

---

#### T22: PSP webhook

**What**: `POST /webhooks/psp` with token check, body validation and translation to `ApplyPaymentResult`.
**Where**: `billing-service/internal/infra/http/`
**Depends on**: T21
**Reuses**: problem details from T6
**Requirement**: PAY-03, PAY-04, PAY-06, PAY-07, PAY-08

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] 204 for applied and repeated outcomes, 401 for a bad token, 400 for a bad body, 404 for an unknown invoice, 409 for a conflict
- [ ] Gate check passes: quick gate; test count ≥ 7

**Tests**: unit
**Gate**: quick

**Commit**: `feat(billing): recebe o webhook de pagamento do PSP`

---

#### T23: Payment workers, wiring and demo

**What**: `PaymentWorker` and `ReconciliationWorker`, their wiring and PSP config in `internal/app`, compose environment and `extra_hosts` for WireMock, payment topics in `create-topics.sh`, and the payment scenarios in `docs/demo-cobranca.md` and `billing-service/CLAUDE.md`.
**Where**: `billing-service/internal/infra/worker/`
**Depends on**: T22
**Reuses**: loop and shutdown pattern of the outbox relay (T7)
**Requirement**: PAY-01, REC-01, REC-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Workers drain due work, stop on an unavailable PSP and on cancel (unit)
- [ ] With `make up`: one iPhone ends `PAID`, seven iPhones end `PAYMENT_FAILED`, the outage stub opens the circuit
- [ ] Gate check passes: build gate; test count ≥ 5 in `internal/infra/worker`

**Tests**: unit
**Gate**: build

**Commit**: `feat(billing): cobra as faturas no PSP com conciliação`

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3 → Phase 4

Phase 1:  T1 → T2
Phase 2:  T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10 → T11
Phase 3:  T12 → T13 → T14 → T15 → T16 → T17
Phase 4:  T18 → T19 → T20 → T21 → T22 → T23
```

Execution is strictly sequential, and each phase's branch starts from the previous phase's branch.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1, T2, T3, T18 | one document each | ✅ Granular |
| T4 | module foundation: config, telemetry, core rules (one cohesive bootstrap step) | ⚠️ Cohesive |
| T5, T6, T7, T14, T15, T16, T20, T21, T22 | one package each | ✅ Granular |
| T8, T17, T23 | composition root plus the files it wires (topics, compose env, demo) | ⚠️ Cohesive |
| T9, T10, T11 | one concern each (image and compose, CI, docs) | ✅ Granular |
| T12, T13, T19 | one core package each | ✅ Granular |

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | start of Phase 1 | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | None | start of Phase 2 | ✅ Match |
| T4 | T3 | T3 → T4 | ✅ Match |
| T5 | T4 | T4 → T5 | ✅ Match |
| T6 | T5 | T5 → T6 | ✅ Match |
| T7 | T6 | T6 → T7 | ✅ Match |
| T8 | T7 | T7 → T8 | ✅ Match |
| T9 | T8 | T8 → T9 | ✅ Match |
| T10 | T9 | T9 → T10 | ✅ Match |
| T11 | T10 | T10 → T11 | ✅ Match |
| T12 | T11 | Phase 2 → Phase 3 | ✅ Match (cross-phase, backward) |
| T13 | T12 | T12 → T13 | ✅ Match |
| T14 | T13 | T13 → T14 | ✅ Match |
| T15 | T14 | T14 → T15 | ✅ Match |
| T16 | T15 | T15 → T16 | ✅ Match |
| T17 | T16 | T16 → T17 | ✅ Match |
| T18 | T17 | Phase 3 → Phase 4 | ✅ Match (cross-phase, backward) |
| T19 | T18 | T18 → T19 | ✅ Match |
| T20 | T19 | T19 → T20 | ✅ Match |
| T21 | T20 | T20 → T21 | ✅ Match |
| T22 | T21 | T21 → T22 | ✅ Match |
| T23 | T22 | T22 → T23 | ✅ Match |

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1, T2, T3, T18 | docs | none | none | ✅ OK |
| T4 | config, observability, core shared | unit | unit | ✅ OK |
| T5 | persistence | integration | integration | ✅ OK |
| T6 | HTTP | unit | unit | ✅ OK |
| T7 | outbox | integration | integration | ✅ OK |
| T8 | composition root | integration | integration | ✅ OK |
| T9 | Docker, compose | none | none | ✅ OK |
| T10 | CI | none | none | ✅ OK |
| T11 | docs | none | none | ✅ OK |
| T12, T13, T19 | core | unit | unit | ✅ OK |
| T14, T20 | persistence | integration | integration | ✅ OK |
| T15 | messaging | unit | unit | ✅ OK |
| T16, T22 | HTTP | unit | unit | ✅ OK |
| T17 | composition root | integration | integration | ✅ OK |
| T21 | PSP adapter | integration | integration | ✅ OK |
| T23 | workers (+ wiring) | unit (+ integration for the root) | unit | ✅ OK: the root wiring is covered by the T17 app test, extended here with the workers |
