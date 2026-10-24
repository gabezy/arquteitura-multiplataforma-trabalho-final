# Receive marketplace orders Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Spec**: `.specs/features/receive-marketplace-orders/spec.md`
**Design**: skipped - the aggregate, facade, repository, consumer and routes follow the patterns already in `order-service/CLAUDE.md`, `catalog-service` and `marketplace-gateway`; the decisions are in the spec's Assumptions table
**Status**: In Progress

**Granularity (user decision, 2026-10-23, kept for this feature):** 8 cohesive tasks, one commit each. Each task is one deliverable that works and can be reverted on its own; `Where` names a directory when the deliverable spans several files.

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `order-service/CLAUDE.md` (co-located tests; facades with in-memory fakes, routes with supertest, persistence and messaging against Testcontainers `postgres:18-alpine`); no coverage threshold in `order-service/jest.config.js`. Floor for style: `order-service/src/infra/messaging/outbox-relay.spec.ts`, `marketplace-gateway/src/infra/messaging/order-cancelled.consumer.spec.ts`, `marketplace-gateway/src/infra/order.module.int.spec.ts`.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Domain model (`core/order/model`, `core/shared/domain/money.vo.ts`) | unit | All branches; 1:1 to ORDER-01, 02, 06 and the SKU edge cases; every `Money` conversion boundary (0, 0.01, 2 vs 3 decimals, `3 × 0.1`) | `order-service/src/core/**/*.spec.ts` | `npx jest src/core` |
| Facade (`core/order/order.facade.ts`) | unit (in-memory fakes of `port/out`) | Every branch: created, duplicate by business key, not found, list filters passed through | `order-service/src/core/order/*.spec.ts` | `npx jest src/core/order` |
| Persistence (migration, `KnexOrderRepository`) | integration (Testcontainers) | Columns and constraints; atomic order + items + inbox + outbox; duplicate and concurrent saves; every filter, pagination and sort of the read side | `order-service/src/infra/persistence/*.spec.ts` | `npx jest src/infra/persistence` |
| Messaging (mapper, consumer, dead letter) | unit (fake facade, producer and inbox) | Every DLQ rule (ORDER-12..15), redelivery skip, rethrow of infra errors, divergent total log, trace context, unknown fields | `order-service/src/infra/messaging/*.spec.ts` | `npx jest src/infra/messaging` |
| HTTP (`order.routes.ts`) | route (supertest, fake ports) | Both routes: happy path, every filter, defaults, every 422 boundary (`limit` 0/1/100/101, `offset` -1, bad enums, non-UUID id), 404, empty page | `order-service/src/infra/http/**/*.spec.ts` | `npx jest src/infra/http` |
| Module wiring (`order.factory.ts`) | integration (Testcontainers + fake Kafka client) | A received message ends as an `orders` row and an outbox `placed` row with `traceparent`; redelivery adds nothing | `order-service/src/infra/*.spec.ts` | `npx jest src/infra/order` |
| Composition root, compose, `create-topics.sh` | none | Build gate + smoke commands listed in the task | - | build gate + smoke |
| Docs | none | - | - | - |

## Gate Check Commands

> Generated from codebase - confirm before Execute. No linter is configured; `typecheck` is the static gate. Integration specs need Docker running (Testcontainers).

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | After tasks with unit or route tests only | `cd order-service && npx jest <task paths> && npm run typecheck` |
| Full | After tasks with integration tests | `cd order-service && npm run typecheck && npm test` |
| Build | After phase completion or wiring/docs tasks | `cd order-service && npm run typecheck && npm run test:coverage -- --ci && npm run build && docker build -t order-service .` |

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: Domain

```
T1 → T2
```

### Phase 2: Persistence

```
T2 → T3
T3 → T4
```

### Phase 3: Adapters and wiring

```
T2 → T5
T2 → T6
T4 → T7
T5 → T7
T6 → T7
T7 → T8
```

---

## Task Breakdown

### T1: Add the `Money` value object and the `Order` aggregate

**What**: `Money` (integer cents; `fromReais` rejects negative, non-finite and more than 2 decimals; `times(quantity)`, `plus`, `toReais()`), and in `core/order/model/` the `Order` aggregate with `Order.receive({ marketplace, externalOrderId, items, orderedAt })`, `Marketplace` and `OrderStatus` (`RECEIVED`, `CONFIRMED`, `PAID`, `CANCELLED`), `OrderItem`, the `OrderPlaced` domain event and `InvalidOrderError` (a `ValidationError`). `receive` generates the UUID, trims `externalOrderId` and SKUs, computes the total in cents, sets `RECEIVED`, `cancellationReason` null, and records `OrderPlaced`.
**Where**: `order-service/src/core/order/model/` (plus `order-service/src/core/shared/domain/money.vo.ts`)
**Depends on**: None
**Reuses**: `core/shared/domain/` (`AggregateRoot`, `DomainEvent`, `Id`, `ValidationError`); `marketplace-gateway/src/core/order/model/marketplace-order.entity.ts` for the item rules
**Requirement**: ORDER-01, ORDER-02, ORDER-06

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `Money.fromReais(0.1).times(3).toReais()` is `0.3`; `189.90 + 18500.00` gives `18689.9`; `fromReais(0)` is accepted; `fromReais(1.234)`, `-0.01`, `NaN` and `Infinity` throw `ValidationError`
- [x] `Order.receive` with 2 items gives status `RECEIVED`, a UUID id, `cancellationReason` null and total = Σ `quantity × unitPrice`
- [x] An item with `unitPrice` 0 is kept and adds 0 to the total (ORDER-06)
- [x] `' NB-001 '` is stored as `'NB-001'`; two lines of the same SKU stay two lines
- [x] Empty items, blank SKU, `quantity` 0 / 1.5 / -1, blank `externalOrderId` and an invalid `Date` throw `InvalidOrderError`
- [x] `pullDomainEvents()` returns one `OrderPlaced` with the order id, marketplace, externalOrderId and items
- [x] Architecture spec still passes (no framework import in `core`)
- [x] Gate check passes: `cd order-service && npx jest src/core && npm run typecheck`
- [x] Test count: 32 new tests pass (`money.vo.spec.ts` 16, `order.entity.spec.ts` 16); 43 in `src/core`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(order): adiciona o agregado Order e o value object Money`

**Status**: ✅ Complete

---

### T2: Add the order ports and the facade

**What**: `port/in` (`ReceiveOrderPort.receive(command)` → `{ outcome: 'created' | 'duplicate', order }`, `ListOrdersPort.list(filter, page)`, `GetOrderPort.get(id)`), `port/out` (`OrderRepository` with `saveReceived(order, eventId?)` → `boolean` created, `findById`, `list`) and `OrderFacade` implementing the three in-ports. `get` throws `OrderNotFoundError` (a `NotFoundError`).
**Where**: `order-service/src/core/order/` (`port/in/`, `port/out/`, `order.facade.ts`)
**Depends on**: T1
**Reuses**: facade pattern in `catalog-service/src/core/product/product.facade.ts`
**Requirement**: ORDER-01, ORDER-09, ORDER-23, ORDER-25

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `receive` on a new marketplace order saves it and returns `created` with the saved order
- [x] `receive` when the repository answers "already exists" returns `duplicate` and the facade records nothing else
- [x] `receive` passes the `eventId` to the repository untouched (also when absent)
- [x] `get` with an unknown id throws `OrderNotFoundError`; with a known id returns the order
- [x] `list` passes `marketplace`, `status`, `limit` and `offset` to the repository untouched
- [x] Gate check passes: `cd order-service && npx jest src/core && npm run typecheck`
- [x] Test count: 6 new tests pass (`order.facade.spec.ts`); 49 in `src/core`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(order): adiciona as portas e a facade de pedidos`

**Status**: ✅ Complete

---

### T3: Persist received orders with inbox and outbox in one transaction

**What**: migration `create_orders_tables` (`orders`: `id` uuid PK, `marketplace`, `external_order_id`, `status`, `total` `decimal(14,2)`, `cancellation_reason` null, `ordered_at`, `created_at`, `updated_at`, unique `(marketplace, external_order_id)`, index `(created_at, id)` (scanned backwards); `order_items`: `order_id` FK, `line`, `sku`, `quantity`, `unit_price` `decimal(14,2)`, PK `(order_id, line)`), the `order.order.placed.v1` mapper in `infra/messaging/order.integration-events.ts`, and the write side of `KnexOrderRepository.saveReceived`: one transaction that inserts the order with `on conflict do nothing`, its items, the `processed_events` row (when there is an `eventId`, `on conflict do nothing`) and the outbox row only when the order was created.
**Where**: `order-service/src/infra/persistence/knex-order.repository.ts` (plus the migration and the mapper)
**Depends on**: T2
**Reuses**: `KnexOutboxRepository.append`, `processed_events` table, `migrations.spec.ts` Testcontainers setup
**Requirement**: ORDER-03, ORDER-04, ORDER-08, ORDER-09, ORDER-10, ORDER-11

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Migration up creates both tables with the columns, the unique constraint and the index; down drops them; re-run applies nothing
- [x] Mapper: `OrderPlaced` → type `order.order.placed.v1`, data `{ orderId, marketplace, externalOrderId, items: [{ sku, quantity, unitPrice }] }` with `unitPrice` in reais; an unmapped event throws
- [x] A new order writes 1 `orders` row, N `order_items` rows, 1 `processed_events` row and 1 outbox row with key = order id, and returns `true`
- [x] The same `marketplace + externalOrderId` with a new `eventId` writes only the `processed_events` row and returns `false`; the stored order is unchanged
- [x] Two concurrent `saveReceived` of the same marketplace order leave 1 order and 1 outbox row
- [x] A failure in the outbox append (mapper throws) leaves no `orders`, `order_items` or `processed_events` row
- [x] `total` and `unit_price` read back exactly (`18689.90`, `0.00`)
- [x] Gate check passes: `cd order-service && npm run typecheck && npm test`
- [x] Test count: 10 new tests pass (`knex-order.repository.spec.ts` 7, `order.integration-events.spec.ts` 2, `migrations.spec.ts` 1); 115 in total

**Tests**: integration
**Gate**: full

**Commit**: `feat(order): persiste o pedido recebido com inbox e outbox na mesma transação`

**Status**: ✅ Complete

**Deviations**: `migrations.spec.ts` and `migration-source.spec.ts` list the migrations by name; both lists were extended with `20261024120000_create_orders_tables` (no assertion removed). The list tiebreaker was made precise in the spec: `id` descending.

---

### T4: Add the read side of the order repository

**What**: `KnexOrderRepository.findById` and `list({ marketplace?, status? }, { limit, offset })`, sorted by `created_at desc, id desc`, rebuilding `Order` with its items in line order and money from `decimal` strings.
**Where**: `order-service/src/infra/persistence/knex-order.repository.ts` (modify)
**Depends on**: T3
**Reuses**: T3 test setup
**Requirement**: ORDER-18, ORDER-20, ORDER-21, ORDER-23, ORDER-25

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `findById` returns the order with all fields and items in line order; an unknown id returns `null`
- [x] `list` with no filter returns newest first, with `id` descending as tiebreaker for equal `created_at`
- [x] Filter by `marketplace`, by `status` and by both returns only matching orders
- [x] `limit` and `offset` page through the result; an offset past the end returns an empty list
- [x] Gate check passes: `cd order-service && npm run typecheck && npm test`
- [x] Test count: 7 new tests pass (`knex-order.repository.spec.ts`); 122 in total

**Tests**: integration
**Gate**: full

**Commit**: `feat(order): adiciona a consulta de pedidos no repositório`

**Status**: ✅ Complete

**Deviations**: adds `Order.restore` to `core/order/model/order.entity.ts`, which the read side needs to rebuild an order without recording an event (covered by `knex-order.repository.spec.ts`, `findById` returns no domain events).

---

### T5: Consume `marketplace.order.received.v1` with DLQ

**What**: `MarketplaceOrderConsumer`: skips a `ce_id` already in the inbox, validates the payload with zod (contract of `docs/eventos.md`), runs the handling inside the message's trace context (`withTraceHeaders`), calls `ReceiveOrderPort`, logs `warn` when the message `total` differs from the computed one, sends unprocessable messages (zod failure, invalid JSON, `DomainError`) to `order.marketplace-order.dlq` with the `dlq-*` headers and marks their `ce_id`, and rethrows anything else. Adds `zod` (same version as `catalog-service`), `dead-letter.ts` and the `Inbox` port + `KnexInbox`.
**Where**: `order-service/src/infra/messaging/marketplace-order.consumer.ts` (plus `dead-letter.ts`, `inbox.ts`, `persistence/knex-inbox.ts`, `package.json`)
**Depends on**: T2
**Reuses**: `marketplace-gateway/src/infra/messaging/dead-letter.ts`, `inbox.ts`, `order-cancelled.consumer.ts`; `infra/observability/trace-context.ts`
**Requirement**: ORDER-05, ORDER-07, ORDER-08, ORDER-12, ORDER-13, ORDER-14, ORDER-15, ORDER-16, ORDER-17, ORDER-30, ORDER-31

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] A valid message calls `receive` with marketplace, externalOrderId, items, `orderedAt` as `Date` and the `ce_id`
- [x] A `ce_id` already in the inbox calls nothing and logs `info`
- [x] Each DLQ case goes to the DLQ with original key, value, headers and `dlq-original-topic/partition/offset/reason`, and `receive` is not called: empty value, invalid JSON, `marketplace: "EBAY"`, blank `externalOrderId`, `items: []`, blank SKU, `quantity` 0 and 1.5, `unitPrice` -1 and `1.234`, `orderedAt: "ontem"`, `total: "4500"`
- [x] A DLQ'd message with `ce_id` marks it in the inbox and logs `warn` with topic, partition, offset and reason
- [x] A repository error (plain `Error`) is rethrown and nothing goes to the DLQ
- [x] `total` 4000 for items summing 4500 logs one `warn` with both totals, marketplace and externalOrderId
- [x] With a `traceparent` header, the active span context inside `receive` has that trace id
- [x] A message with extra unknown fields is processed
- [x] `KnexInbox` (Testcontainers): `hasProcessed` is false then true after `markProcessed`; marking the same id twice does not fail
- [x] Gate check passes: `cd order-service && npm run typecheck && npm test`
- [x] Test count: 26 new tests pass (`marketplace-order.consumer.spec.ts` 24, `knex-inbox.spec.ts` 2); 148 in total

**Tests**: integration
**Gate**: full

**Commit**: `feat(order): consome os pedidos recebidos dos marketplaces com DLQ`

**Status**: ✅ Complete

**Deviations**: `unitPrice` with more than two decimals passes the zod schema and is refused by `Money` in the domain (`InvalidMoneyError`, a `ValidationError`), which the consumer sends to the DLQ like any `DomainError`. `KnexInbox` is a copy of the marketplace-gateway one.

**Security fix (after the commit review)**: a value the database can never store (int4 `quantity`, `decimal(14,2)` money, NUL in text, a NUL or oversized `ce_id`) used to be rethrown and redelivered forever, stalling the partition. The schema now has the storage limits, `ce_id` is checked before the inbox, and an SQLSTATE class 22 error goes to the DLQ (ORDER-30, ORDER-31). 9 more tests; 33 in `marketplace-order.consumer.spec.ts`, 181 in total.

---

### T6: Add the order routes for the BFF

**What**: `orderRoutes(listOrders, getOrder)`: `GET /orders` validating `marketplace`, `status`, `limit` (1-100, default 20) and `offset` (≥ 0, default 0) with zod → `ValidationError` (422), and `GET /orders/:id` (non-UUID → 422, unknown → 404), serializing the shape of ORDER-19.
**Where**: `order-service/src/infra/http/order/order.routes.ts`
**Depends on**: T2
**Reuses**: `infra/http/error-handler.ts`, `health.routes.ts` style, supertest specs
**Requirement**: ORDER-18, ORDER-19, ORDER-20, ORDER-21, ORDER-22, ORDER-23, ORDER-24, ORDER-25

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `GET /orders` → 200 `{ orders, limit: 20, offset: 0 }` with each order as `{ id, marketplace, externalOrderId, status, total, items, cancellationReason, orderedAt, createdAt, updatedAt }`, money as numbers (`18689.9`), instants ISO-8601 UTC
- [x] Filters and paging reach the port untouched and are echoed
- [x] 422 `application/problem+json` for `limit` 0, 101, `abc`; `offset` -1; `marketplace=EBAY`; `status=SHIPPED`; `limit` 1 and 100 are accepted
- [x] `GET /orders/{uuid}` → 200 with the order; unknown UUID → 404 problem+json; `/orders/abc` → 422 problem+json
- [x] Empty page → 200 with `orders: []`
- [x] Gate check passes: `cd order-service && npx jest src/infra/http && npm run typecheck`
- [x] Test count: 24 new tests pass (`order.routes.spec.ts`); 33 in `src/infra/http`

**Tests**: route
**Gate**: quick

**Commit**: `feat(order): adiciona as rotas de consulta de pedidos para o BFF`

**Status**: ✅ Complete

**Deviations**: the routes are tested on their own Express app with the real `errorHandler`; `createApp` takes them in T7. Invalid parameters throw `InvalidRequestError`, a `ValidationError`, which the existing error handler already answers with 422.

---

### T7: Wire the order module and run it in the compose

**What**: `infra/order.factory.ts` (repository, facade, consumer with group `order-service-marketplace-orders` subscribing `fromBeginning`, routes), `kafka.config.ts` exposing a consumer, `createApp` taking the order routes, `main.ts` connecting the consumer before `listen` and disconnecting it first on shutdown, `order.marketplace-order.dlq` in `docker/kafka/create-topics.sh`, and a module spec: a received message through the wired module becomes an `orders` row and an outbox `placed` row carrying the message's `traceparent`.
**Where**: `order-service/src/infra/order.factory.ts` (plus `main.ts`, `kafka.config.ts`, `http/app.ts`, `docker/kafka/create-topics.sh`)
**Depends on**: T4, T5, T6
**Reuses**: `marketplace-gateway/src/infra/order.factory.ts` and `order.module.int.spec.ts`
**Requirement**: ORDER-07, ORDER-26, ORDER-27, ORDER-28, ORDER-29

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Module spec: a message through `eachMessage` writes 1 order and 1 outbox `order.order.placed.v1` row whose `headers.traceparent` has the message's trace id; the same message again adds nothing
- [ ] Build gate passes: `cd order-service && npm run typecheck && npm run test:coverage -- --ci && npm run build && docker build -t order-service .`
- [ ] Smoke: `docker compose up -d kafka-init` lists `order.marketplace-order.dlq` (1 partition, `retention.ms=1209600000`)
- [ ] Smoke: `make up` → an order polled from a simulator appears in `orders` as `RECEIVED`, its `placed` reaches Kafka and the catalog answers with `catalog.stock.*`
- [ ] Smoke: `curl -H "Authorization: Bearer $CSM" localhost:8080/orders` through the BFF → 200 with that order; `/orders/<id>` → 200
- [ ] Smoke: `{}` published to `marketplace.order.received.v1` lands in `order.marketplace-order.dlq` and the next valid order is still saved
- [ ] Smoke: with Kafka stopped, starting the service exits with code 1; `docker stop order-service` logs the consumer disconnect before the relay stop and exits 0
- [ ] Smoke: the trace of the order spans marketplace-gateway → order-service → catalog-service in Grafana (Tempo)

**Tests**: integration
**Gate**: build

**Commit**: `feat(order): conecta o módulo de pedidos e o consumer no order-service`

**Status**: Pending

---

### T8: Document orders and mark the contracts as implemented

**What**: in `docs/eventos.md`, `marketplace.order.received.v1` and `order.order.placed.v1` (with the optional fields now sent) → Implementado, `order.marketplace-order.dlq` → Implementado with group `order-service-marketplace-orders`, the BFF → order-service list/detail call → Implementado, and the known limitation of `unitPrice` 0 vs the billing; `order-service/CLAUDE.md` (domain, consumer, routes, money rule); spec traceability updated and the copy in `docs/specs/order-service/pedidos/spec.md` synced.
**Where**: `docs/eventos.md` (plus `order-service/CLAUDE.md` and the spec copy)
**Depends on**: T7
**Reuses**: existing fichas in `docs/eventos.md`
**Requirement**: all (traceability)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] The overview table and the fichas show the new states; no other service's ficha changed
- [ ] `order-service/CLAUDE.md` no longer says "There is no domain yet"
- [ ] `diff .specs/features/receive-marketplace-orders/spec.md docs/specs/order-service/pedidos/spec.md` is empty
- [ ] Gate check passes: build gate from T7

**Tests**: none
**Gate**: build

**Commit**: `docs(order): documenta os pedidos e marca os contratos como implementados`

**Status**: Pending

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3

Phase 1:  T1 ------→ T2
Phase 2:  T2 ------→ T3 ------→ T4
Phase 3:  T2 ------→ T5 ------→ T7
          T2 ------→ T6 ------→ T7
          T4 ------→ T7 ------→ T8
```

T3 depends on T2 (previous phase); T5 and T6 depend on T2, and T7 on T4 (previous phases). Execution is strictly sequential: T1, T2, T3, T4, T5, T6, T7, T8.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: Money and Order | 1 aggregate + 1 value object | ⚠️ Cohesive by user decision |
| T2: Ports and facade | 1 facade + its ports | ✅ |
| T3: Write side of the repository | 1 method + its migration and mapper | ⚠️ Cohesive by user decision |
| T4: Read side of the repository | 2 methods in 1 file | ✅ |
| T5: Consumer with DLQ | 1 consumer + its helpers | ⚠️ Cohesive by user decision |
| T6: Order routes | 2 endpoints in 1 file | ✅ |
| T7: Wiring and compose | Wiring + runtime files | ⚠️ Cohesive by user decision |
| T8: Docs | Docs only | ✅ |

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | - | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T2 | T2 → T3 | ✅ Match |
| T4 | T3 | T3 → T4 | ✅ Match |
| T5 | T2 | T2 → T5 | ✅ Match |
| T6 | T2 | T2 → T6 | ✅ Match |
| T7 | T4, T5, T6 | T4 → T7, T5 → T7, T6 → T7 | ✅ Match |
| T8 | T7 | T7 → T8 | ✅ Match |

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | Domain model | unit | unit | ✅ OK |
| T2 | Facade | unit | unit | ✅ OK |
| T3 | Persistence + messaging mapper | integration / unit | integration | ✅ OK |
| T4 | Persistence | integration | integration | ✅ OK |
| T5 | Messaging + inbox persistence | unit / integration | integration | ✅ OK |
| T6 | HTTP | route | route | ✅ OK |
| T7 | Module wiring + composition root | integration / none | integration | ✅ OK |
| T8 | Docs | none | none | ✅ OK |

