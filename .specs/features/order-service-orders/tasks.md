# order-service orders Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task commit, gates, status updates, Verifier).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Spec**: `.specs/features/order-service-orders/spec.md`
**Design**: `.specs/features/order-service-orders/design.md`
**Status**: Approved (2026-10-24)

**Granularity:** cohesive tasks, one commit each, as in `.specs/features/billing-service/tasks.md`. Each task is one deliverable that builds, passes its gate and can be reverted alone.

**Branch and pull request:** one branch, `feature/20-pedidos-do-order-service` (from `dev`), and one pull request to `dev` that closes #20, #29, #31 and #14.

---

## Test Coverage Matrix

> Generated from the codebase and the guidelines in `order-service/CLAUDE.md` and `catalog-service/CLAUDE.md` (unit tests with fakes of the ports, adapters tested against a throwaway Postgres from Testcontainers).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Core model and facades | unit | All branches; 1:1 to spec ACs; every listed edge case | `order-service/src/core/**/*.spec.ts` | `npx jest src/core` |
| Persistence | integration (Testcontainers Postgres) | Round trip, uniqueness, optimistic lock, list, report | `order-service/src/infra/persistence/*.spec.ts` | `npx jest src/infra/persistence` |
| Messaging (consumers, mapping) | unit (fake facade, fake Kafka objects) | Every consumer AC: happy, DLQ, transient rethrow | `order-service/src/infra/messaging/*.spec.ts` | `npx jest src/infra/messaging` |
| HTTP | unit (supertest, fake ports) | All routes: happy + edge + error | `order-service/src/infra/http/**/*.spec.ts` | `npx jest src/infra/http` |
| Flow | integration (Testcontainers Postgres) | The order life cycle through the real repository and outbox | `order-service/src/infra/order-flow.spec.ts` | `npx jest src/infra/order-flow` |
| Docs, topics | none | Build or docs gate only | - | build or docs gate |

## Gate Check Commands

> Commands run from `order-service/` unless noted.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Tasks with unit tests only | `npm run typecheck && npx jest src/core src/infra/messaging src/infra/http` |
| Full | Tasks with integration tests | `npm run typecheck && npm test` (Docker running) |
| Build | Phase completion and wiring tasks | `npm run typecheck && npm run build && npm test` |
| Docs | Documentation-only tasks (from the repository root) | `git diff --check && python3 <skill-dir>/scripts/validate_spec.py .specs/features/order-service-orders/spec.md` |

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: Plan and core

```
T1 → T2 → T3
```

### Phase 2: Adapters

```
T4 → T5 → T6 → T7
```

### Phase 3: Wiring, flow and docs

```
T8 → T9 → T10
```

---

## Task Breakdown


### Phase 1: Plan and core

#### T1: Spec, design and plan

**What**: Documents the feature: spec with requirement ids, design and this plan, with the copy of the spec in `docs/specs/order-service/orders/`.
**Where**: .specs/features/order-service-orders/, docs/specs/order-service/orders/
**Depends on**: None
**Reuses**: bootstrap documents
**Requirement**: ORD-01 to INF-04 (documentation)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Spec validates with `validate_spec.py`
- [x] Tasks validate with `validate_tasks.py`
- [x] Gate check passes: docs gate

**Tests**: none
**Gate**: docs

**Commit**: `docs(order): adiciona spec, design e plano dos pedidos`

---


#### T2: Order model

**What**: Order aggregate with its states and transitions, value objects (money in cents, marketplace, item, reason), domain events and errors.
**Where**: `order-service/src/core/order/model/`
**Depends on**: T1
**Reuses**: `catalog-service` patterns
**Requirement**: ORD-01, ORD-04, STK-01, STK-02, STK-03, PAY-01, PAY-02, PAY-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Every bound of the spec (items, quantity, price, decimals, total, marketplace) rejected with an `InvalidOrderError`
- [ ] Every transition and every no-op of the state table, and the conflicts, have a test
- [ ] `Order.receive` records `OrderPlaced`; each transition records its event with the data of the contract
- [ ] Gate check passes: quick gate; test count ≥ 30

**Tests**: unit
**Gate**: quick

**Commit**: `feat(order): adiciona o agregado de pedido com seus estados`

---


#### T3: Order ports and facades

**What**: Driving ports, the `OrderRepositoryPort`, `OrderFacade` (receive, stock outcomes, payment results, find, list) and `SalesReportFacade`.
**Where**: `order-service/src/core/order/`
**Depends on**: T2
**Reuses**: `catalog-service` patterns
**Requirement**: ORD-01, ORD-02, STK-01 to STK-04, PAY-01 to PAY-04, API-01, RPT-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] A repeated marketplace order returns the existing order and saves nothing
- [ ] Each outcome applied once, repeated once more and contradicted, with the repository fake
- [ ] An unknown order is a `NotFoundError`
- [ ] The report fills the marketplaces without sales with zeros and rejects a reversed period
- [ ] Gate check passes: quick gate; test count ≥ 20

**Tests**: unit
**Gate**: quick

**Commit**: `feat(order): adiciona os casos de uso do pedido e do relatório`

---


### Phase 2: Adapters

#### T4: Order persistence

**What**: Migration of `orders`, `KnexOrderRepository` with the outbox in the same transaction and optimistic lock, the list and the sales report query.
**Where**: `order-service/src/infra/persistence/`
**Depends on**: T3
**Reuses**: `catalog-service` patterns
**Requirement**: ORD-01, ORD-02, ORD-03, API-03, RPT-01, RPT-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] A new order round trips with its items and money in cents
- [ ] The unique marketplace and external order id raises `ConcurrentModificationError`
- [ ] A stale version raises `ConcurrentModificationError`
- [ ] List filters, pagination and order; report counts only `CONFIRMED` and `PAID` inside the period
- [ ] Gate check passes: full gate; test count ≥ 10

**Tests**: integration
**Gate**: full

**Commit**: `feat(order): persiste os pedidos com o outbox e o relatório de vendas`

---


#### T5: Order integration events

**What**: Mapper of `OrderPlaced`, `OrderConfirmed` and `OrderCancelled` to the topics and payloads of the event catalog.
**Where**: `order-service/src/infra/messaging/order.integration-events.ts`
**Depends on**: T4
**Reuses**: `catalog-service` patterns
**Requirement**: ORD-01, STK-01, STK-02, PAY-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Each payload equals the contract of `docs/eventos.md`, with money as numbers and dates in UTC
- [ ] An unmapped event is rejected

**Tests**: unit
**Gate**: quick

**Commit**: `feat(order): mapeia os eventos do pedido para o catálogo`

---


#### T6: Order HTTP API

**What**: `GET /orders`, `GET /orders/:id` and `GET /reports/sales-by-marketplace` with validation of the shape and the 400 problem with the invalid parameters.
**Where**: `order-service/src/infra/http/`
**Depends on**: T5
**Reuses**: `catalog-service` patterns
**Requirement**: API-01, API-02, API-03, API-04, RPT-01, RPT-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Every route has its happy path, 404 and 400 cases
- [ ] Money and dates have the shape of the BFF contract
- [ ] Gate check passes: quick gate; test count ≥ 12

**Tests**: unit
**Gate**: quick

**Commit**: `feat(order): expõe a API de consulta e o relatório de vendas`

---


#### T7: Kafka consumers

**What**: Schemas of the five consumed contracts, handlers, the generic `TopicConsumer` with dead letter and the CloudEvents header check.
**Where**: `order-service/src/infra/messaging/`
**Depends on**: T6
**Reuses**: `catalog-service` patterns
**Requirement**: ORD-01, ORD-04, ORD-05, STK-01, STK-02, STK-04, PAY-01, PAY-02, PAY-04, INF-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Every valid message reaches the facade with the data of the contract
- [ ] Every violation of ORD-04 goes to the dead letter of its group with the `dlq-*` headers
- [ ] A domain error goes to the dead letter and a transient error is rethrown
- [ ] Gate check passes: quick gate; test count ≥ 20

**Tests**: unit
**Gate**: quick

**Commit**: `feat(order): consome os pedidos, o estoque e o pagamento`

---


### Phase 3: Wiring, flow and docs

#### T8: Composition and topics

**What**: Order module factory, `main.ts` with the three consumers and the ordered shutdown, Kafka consumers config, the dead letter topics in `create-topics.sh`.
**Where**: `order-service/src/`, `docker/kafka/create-topics.sh`
**Depends on**: T7
**Reuses**: `catalog-service` patterns
**Requirement**: INF-01, INF-02, INF-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] The three dead letter topics exist in the script with one partition and 14 days of retention
- [ ] The shutdown order disconnects consumers, closes the server, stops the relay and the producer
- [ ] Gate check passes: build gate

**Tests**: unit
**Gate**: build

**Commit**: `feat(order): liga os consumers e as DLQs no composition root`

---


#### T9: Order flow test

**What**: A test that runs the whole life cycle through the real repository and outbox on Postgres: marketplace order, stock answers and payment results, with the events published and the report of the demo orders.
**Where**: `order-service/src/infra/`
**Depends on**: T8
**Reuses**: `catalog-service` patterns
**Requirement**: ORD-01, ORD-02, RPT-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] One iPhone confirmed and paid, seven cancelled for payment and one without stock cancelled, each with the events of the contract
- [ ] A repeated marketplace order leaves one order and one `placed`
- [ ] The report of those orders matches the demo
- [ ] Gate check passes: full gate; test count ≥ 3

**Tests**: integration
**Gate**: full

**Commit**: `test(order): cobre o ciclo do pedido ponta a ponta no Postgres`

---


#### T10: Documentation

**What**: `order-service/CLAUDE.md`, README, states of the event catalog and the demo script of the order flow.
**Where**: `order-service/CLAUDE.md`, `README.md`, `docs/eventos.md`, `docs/demo-pedidos.md`
**Depends on**: T9
**Reuses**: bootstrap documents
**Requirement**: INF-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] The CLAUDE.md describes the aggregate, the consumers, the API and the settings
- [ ] The states of the order events in the catalog say Implementado
- [ ] Gate check passes: docs gate

**Tests**: none
**Gate**: docs

**Commit**: `docs(order): documenta o ciclo do pedido e a demo`

---


## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3

Phase 1:  T1 → T2 → T3
Phase 2:  T4 → T5 → T6 → T7
Phase 3:  T8 → T9 → T10
```

Execution is strictly sequential on one branch.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1, T10 | one set of documents each | ✅ Granular |
| T2, T3 | one core package each (model, then ports and facades) | ✅ Granular |
| T4, T5, T6, T7 | one adapter each (persistence, mapping, HTTP, consumers) | ✅ Granular |
| T8 | composition root plus the files it wires (topics, factory) | ⚠️ Cohesive |
| T9 | one flow test | ✅ Granular |

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | start of Phase 1 | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T2 | T2 → T3 | ✅ Match |
| T4 | T3 | Phase 1 → Phase 2 | ✅ Match (cross-phase, backward) |
| T5 | T4 | T4 → T5 | ✅ Match |
| T6 | T5 | T5 → T6 | ✅ Match |
| T7 | T6 | T6 → T7 | ✅ Match |
| T8 | T7 | Phase 2 → Phase 3 | ✅ Match (cross-phase, backward) |
| T9 | T8 | T8 → T9 | ✅ Match |
| T10 | T9 | T9 → T10 | ✅ Match |

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1, T10 | docs | none | none | ✅ OK |
| T2, T3 | core | unit | unit | ✅ OK |
| T4 | persistence | integration | integration | ✅ OK |
| T5, T6, T7 | messaging, HTTP | unit | unit | ✅ OK |
| T8 | composition root | unit | unit | ✅ OK |
| T9 | flow | integration | integration | ✅ OK |
