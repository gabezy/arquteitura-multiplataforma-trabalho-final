# catalog-service stock reservation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** catalog-service debits stock on `order.order.placed.v1`, returns it on `order.order.cancelled.v1`, and publishes `catalog.stock.reserved.v1`, `catalog.stock.insufficient.v1` and `catalog.product.stock-changed.v1` through the outbox.

**Architecture:** New `StockReservation` aggregate (one per order) in `core/stock/`, driven by a `StockFacade` through `ReserveStockPort` / `ReleaseStockPort`. A `KnexStockReservationRepository` saves the reservation, the changed products (optimistic `version`) and the outbox rows in one transaction. An `OrderStockConsumer` with its own consumer group translates the order events.

**Tech Stack:** Node 22, TypeScript 6, Express 5, Knex (Postgres; SQLite in repository specs), kafkajs, zod, Jest.

**Spec:** `docs/superpowers/specs/2026-10-21-catalog-stock-reservation-design.md`

All paths below are relative to `catalog-service/` unless they start with `docker/` or `docs/`. Commands run from `catalog-service/`.

## Global Constraints

- Hexagonal rules from `catalog-service/CLAUDE.md`: `core` imports nothing from `infra`, Knex, kafkajs or zod; domain errors extend `ValidationError` / `NotFoundError` / `ConflictError`.
- Migrations are expand-only (add column with default, add table).
- Topics: `order.order.placed.v1`, `order.order.cancelled.v1`, `catalog.stock.reserved.v1`, `catalog.stock.insufficient.v1`, `catalog.product.stock-changed.v1` with 3 partitions; `catalog.order-stock.dlq` with 1 partition and `retention.ms=1209600000`.
- Env vars and defaults: `ORDER_PLACED_TOPIC=order.order.placed.v1`, `ORDER_CANCELLED_TOPIC=order.order.cancelled.v1`, `ORDER_STOCK_DLQ_TOPIC=catalog.order-stock.dlq`.
- Consumer group for order events: `catalog-service-order-stock`.
- Outbox `aggregate_type`: `StockReservation` for reservation events, `Product` for stock-changed.
- Commits: Conventional Commits in Portuguese, ending with `Refs #30` and the `Co-Authored-By` line.
- Code style follows the surrounding files (4-space indent in `src/core` and `src/infra/persistence|messaging`, 2-space in specs/factory/main, double quotes in core).

## Review Focus

1. **Cancel arrives before placed** → tombstone `CANCELLED`, the later `placed` leaves stock untouched and publishes nothing. Test in Task 3.
2. **Same SKU twice in one order, different case** (`nb-001` ×1 and `NB-001` ×2) → treated as one line of 3. Test in Task 3.
3. **Analysis completion after a stock debit** (`ProductFacade.completeAnalysis` loads, order debits, analysis saves) → stock must not be overwritten. Covered by `save` merging only non-stock columns; test in Task 1.
4. **Concurrent debit of the same product** (stale `version`) → `ConcurrentModificationError`, transaction rolled back, nothing in outbox. Test in Task 4.
5. **`placed` with a malformed SKU string** (`"sku 1!"`) → `insufficient` with `available: 0`, never the DLQ. Test in Task 3 (facade) and Task 5 (consumer passes it through).

Deviation from spec, builder's call: repository specs run on SQLite like the existing `knex-product.repository.spec.ts` (the spec mentioned Testcontainers); the versioned `UPDATE` and the transaction behave the same. Reservations are upserted (`onConflict('order_id').merge`) instead of relying on a primary-key violation, since the single consumer processes partitions serially and a concurrent duplicate `placed` that changes stock already fails on the product `version`.

---

### Task 1: Product version, stock-changed event, `findBySkus`

**Files:**
- Create: `src/core/product/model/product-stock-changed.event.ts`
- Create: `src/infra/persistence/migrations/20261021120000_add_version_to_products.ts`
- Modify: `src/core/product/model/product.entity.ts`
- Modify: `src/core/product/port/out/product.repository.ts`
- Modify: `src/infra/persistence/knex-product.repository.ts`
- Modify: `src/infra/messaging/product.integration-events.ts`
- Modify: `src/core/product/product.facade.spec.ts` (fake gains `findBySkus`)
- Test: `src/core/product/model/product.entity.spec.ts`, `src/infra/persistence/knex-product.repository.spec.ts`, `src/infra/messaging/product.integration-events.spec.ts`

**Interfaces:**
- Produces:
  - `class ProductStockChanged extends DomainEvent { eventName = 'ProductStockChanged'; constructor(aggregateId: string, readonly sku: string, readonly stock: number) }`
  - `ProductEntity.version: number` (getter). `create` → 0. `RestoreProductEntityProps.version: number`.
  - `ProductEntity.isAvailableForOrders(): boolean` → `analysisStatus` is `APPROVED`.
  - `addStock` / `removeStock` record `ProductStockChanged(id, sku, newStock)`.
  - `ProductRepositoryPort.findBySkus(skus: Sku[]): Promise<ProductEntity[]>`.
  - Mapper: `ProductStockChanged` → `{ type: 'catalog.product.stock-changed.v1', data: { productId, sku, stock } }`.

- [ ] **Step 1: Write failing tests**

`product.entity.spec.ts`:
```ts
it("records the new stock when stock is removed", () => {
  const product = productWithStock(10);
  product.pullDomainEvents();
  product.removeStock(new Quantity(4));
  const [event] = product.pullDomainEvents();
  expect(event).toBeInstanceOf(ProductStockChanged);
  expect(event).toMatchObject({ aggregateId: product.id.value, sku: product.sku.value, stock: 6 });
});
// same for addStock (10 + 5 → stock: 15)
it("does not record anything when removing more than the stock", () => { /* throws InsufficientStockError, pullDomainEvents() after the first pull is [] */ });
it("starts at version 0 and keeps the restored version", () => { /* create → 0; restore({ ..., version: 3 }).version → 3 */ });
it.each([["APPROVED", true], ["PENDING", false], ["REJECTED", false]])("is available for orders when %s: %s", ...);
```

`knex-product.repository.spec.ts`:
```ts
it("finds the products for several SKUs, ignoring unknown ones", async () => {
  const a = newProduct(); const b = newProduct();
  await repository.saveAll([a, b]);
  const found = await repository.findBySkus([a.sku, b.sku, new Sku("ZZ-999")]);
  expect(found.map(p => p.sku.value).sort()).toEqual([a.sku.value, b.sku.value].sort());
});
it("returns no products for no SKUs", async () => expect(await repository.findBySkus([])).toEqual([]));
it("restores the stored version", async () => { /* save new product, update products set version = 4 directly, findBySku → version 4 */ });
it("does not overwrite stock when saving an existing product", async () => {
  const product = newProduct({ stock: new Quantity(10) });
  await repository.save(product);
  const loaded = (await repository.findBySku(product.sku))!;
  await db("products").where({ id: product.id.value }).update({ stock: 3 }); // a stock debit in between
  loaded.approveAnalysis();
  await repository.save(loaded);
  expect((await repository.findBySku(product.sku))!.stock.value).toBe(3);
  expect((await repository.findBySku(product.sku))!.analysisStatus).toBe(ProductAnalysisStatus.APPROVED);
});
```

`product.integration-events.spec.ts`:
```ts
it("maps ProductStockChanged to catalog.product.stock-changed.v1", () => {
  expect(toProductIntegrationEvent(new ProductStockChanged("p-1", "NB-001", 6)))
    .toEqual({ type: "catalog.product.stock-changed.v1", data: { productId: "p-1", sku: "NB-001", stock: 6 } });
});
```

- [ ] **Step 2: Run `npx jest src/core/product src/infra/persistence/knex-product src/infra/messaging/product.integration` — expect FAIL (missing event, `findBySkus`, `version`).**

- [ ] **Step 3: Implement**
  - Migration: `products.version integer not null default 0`; `down` drops it.
  - Entity: `_version` field, `version` getter, `isAvailableForOrders()`, record the event after the stock change succeeds.
  - Repository: `ProductRow.version: number`; `toEntity` passes `version`; `toRow` does **not** write `version` (insert uses the column default); `save`/`saveAll` use `.onConflict('id').merge(['name', 'description', 'price', 'analysis_status'])` so an existing row keeps its `stock` and `version`. `findBySkus` uses `whereIn('sku', …)`.
  - Facade spec fake: `findBySkus` filters the map.

- [ ] **Step 4: Run `npm test && npm run typecheck` — expect PASS.**

- [ ] **Step 5: Commit** `feat(catalog): versiona produto e registra mudança de estoque`

---

### Task 2: `StockReservation` aggregate and its integration events

**Files:**
- Create: `src/core/stock/model/stock-reservation.entity.ts`
- Create: `src/core/stock/model/stock-reservation-status.vo.ts`
- Create: `src/core/stock/model/stock-reservation.events.ts`
- Create: `src/infra/messaging/stock.integration-events.ts`
- Test: `src/core/stock/model/stock-reservation.entity.spec.ts`, `src/infra/messaging/stock.integration-events.spec.ts`

**Interfaces:**
- Consumes: `AggregateRoot<Id>`, `Id`, `DomainEvent`, `toProductIntegrationEvent` (Task 1).
- Produces:
  - `interface ReservedItem { sku: string; quantity: number }`
  - `interface StockShortage { sku: string; requested: number; available: number }`
  - `StockReservationStatus` VO in the style of `ProductAnalysisStatus`: `RESERVED`, `REJECTED`, `RELEASED`, `CANCELLED`.
  - `class StockReservation extends AggregateRoot<Id>`:
    - `static reserve(orderId: Id, items: ReservedItem[]): StockReservation` — records `StockReserved`
    - `static reject(orderId: Id, shortages: StockShortage[]): StockReservation` — records `StockInsufficient`; `items` = shortages mapped to `{ sku, quantity: requested }`
    - `static cancelBeforePlaced(orderId: Id): StockReservation` — `items: []`, records nothing
    - `static restore(props: { orderId: Id; items: ReservedItem[]; status: StockReservationStatus }): StockReservation`
    - `release(): boolean` — `true` and status `RELEASED` only from `RESERVED`; otherwise `false`, no change
    - getters `orderId: Id` (same as `id`), `items: ReservedItem[]`, `status`
  - `class StockReserved extends DomainEvent { eventName = 'StockReserved'; constructor(aggregateId: string, readonly items: ReservedItem[]) }`
  - `class StockInsufficient extends DomainEvent { eventName = 'StockInsufficient'; constructor(aggregateId: string, readonly items: StockShortage[]) }`
  - `toStockIntegrationEvent: IntegrationEventMapper` — `StockReserved` → `catalog.stock.reserved.v1` `{ orderId, items }`; `StockInsufficient` → `catalog.stock.insufficient.v1` `{ orderId, items }`; anything else delegated to `toProductIntegrationEvent`.

- [ ] **Step 1: Write failing tests** — `reserve` gives `RESERVED` and one `StockReserved` with the items; `reject` gives `REJECTED` and one `StockInsufficient` with the shortages; `cancelBeforePlaced` gives `CANCELLED`, empty items, no events; `restore` records nothing; `release()` from `RESERVED` → `true`, status `RELEASED`; from `REJECTED`, `RELEASED`, `CANCELLED` → `false`, status unchanged. Mapper: both stock events map to the exact types and payloads above with `orderId` = aggregate id; `ProductStockChanged` still maps to `catalog.product.stock-changed.v1`.

- [ ] **Step 2: Run `npx jest src/core/stock src/infra/messaging/stock` — expect FAIL.**

- [ ] **Step 3: Implement** the files above.

- [ ] **Step 4: Run `npm test && npm run typecheck` — expect PASS.**

- [ ] **Step 5: Commit** `feat(catalog): adiciona agregado de reserva de estoque`

---

### Task 3: `StockFacade` with reserve and release

**Files:**
- Create: `src/core/stock/port/in/reserve-stock.port.ts`
- Create: `src/core/stock/port/in/release-stock.port.ts`
- Create: `src/core/stock/port/out/stock-reservation.repository.ts`
- Create: `src/core/stock/stock.facade.ts`
- Test: `src/core/stock/stock.facade.spec.ts`

**Interfaces:**
- Consumes: `ProductRepositoryPort.findBySkus`, `ProductEntity.removeStock/addStock/isAvailableForOrders` (Task 1); `StockReservation` (Task 2).
- Produces:
  - `interface ReserveStockPortInput { orderId: string; items: { sku: string; quantity: number }[] }`; `interface ReserveStockPort { reserve(input: ReserveStockPortInput): Promise<void> }`
  - `interface ReleaseStockPortInput { orderId: string }`; `interface ReleaseStockPort { release(input: ReleaseStockPortInput): Promise<void> }`
  - `interface StockReservationRepositoryPort { findByOrderId(orderId: Id): Promise<StockReservation | null>; save(reservation: StockReservation, products: ProductEntity[]): Promise<void> }` — saves reservation and products atomically; `products` may be empty.
  - `class StockFacade implements ReserveStockPort, ReleaseStockPort { constructor(productRepository: ProductRepositoryPort, reservationRepository: StockReservationRepositoryPort) }`

`reserve` algorithm (the part the tests don't fully pin):
1. Existing reservation for `orderId` → return.
2. Merge lines by key = normalized SKU (`new Sku(raw).value`) or, if `Sku` throws, the raw string; sum quantities; keep first-seen order. Lines with an invalid SKU are kept apart (never looked up).
3. `findBySkus` for the valid SKUs.
4. Shortage per line: no product or `!isAvailableForOrders()` → `available: 0`; `stock < requested` → `available: stock`.
5. Any shortage → `save(StockReservation.reject(id, shortages), [])`. Else `removeStock` each product, `save(StockReservation.reserve(id, mergedLines), products)`.

`release`: none → `save(StockReservation.cancelBeforePlaced(id), [])`; `release()` false → return; else `findBySkus` for the items, `addStock` each, `save(reservation, products)`. A product missing at release time is skipped (it can't be deleted today; no error).

- [ ] **Step 1: Write failing tests** with an `InMemoryProductRepository` (as in `product.facade.spec.ts`, plus `findBySkus`) and an `InMemoryStockReservationRepository` that records each `save(reservation, products)` call and the events it pulled. Product helper creates and approves a product with a given stock. Cases:
  - reserves 1 of 2: stock 1, one save with status `RESERVED`, events `StockReserved{items:[{sku:"NB-001",quantity:1}]}` and `ProductStockChanged{stock:1}`
  - 2 requested of 1: stock unchanged, status `REJECTED`, `StockInsufficient{items:[{sku:"NB-001",requested:2,available:1}]}`, products saved: `[]`
  - multi-item all-or-nothing: `NB-001`×1 (stock 5) + `NB-002`×3 (stock 1) → both stocks unchanged, one shortage for `NB-002`
  - unknown SKU and `PENDING` product → `available: 0`
  - malformed `"sku 1!"` → shortage `{ sku: "sku 1!", requested: 1, available: 0 }`, no lookup error thrown
  - `nb-001`×1 + `NB-001`×2 with stock 3 → stock 0, reserved items `[{ sku: "NB-001", quantity: 3 }]`
  - redelivered `placed` (same orderId twice) → stock debited once, second call saves nothing
  - release after reserve → stock back to 2, status `RELEASED`, `ProductStockChanged{stock:2}`
  - release twice → second call saves nothing
  - release of a rejected order → saves nothing
  - release of unknown order → saves `CANCELLED`; a later `reserve` for it → stock unchanged, nothing saved, no events

- [ ] **Step 2: Run `npx jest src/core/stock/stock.facade` — expect FAIL.**

- [ ] **Step 3: Implement** ports and facade.

- [ ] **Step 4: Run `npm test && npm run typecheck` — expect PASS.**

- [ ] **Step 5: Commit** `feat(catalog): reserva e devolve estoque a partir do pedido`

---

### Task 4: `KnexStockReservationRepository`

**Files:**
- Create: `src/infra/persistence/migrations/20261021120100_create_stock_reservations_table.ts`
- Create: `src/infra/persistence/knex-stock-reservation.repository.ts`
- Create: `src/infra/persistence/concurrent-modification.error.ts`
- Test: `src/infra/persistence/knex-stock-reservation.repository.spec.ts`

**Interfaces:**
- Consumes: `StockReservationRepositoryPort` (Task 3), `KnexOutboxRepository.append(tx, aggregateType, events)`, `toStockIntegrationEvent` (Task 2).
- Produces:
  - `class ConcurrentModificationError extends Error` (plain `Error`, not a `DomainError`, so the consumer rethrows it)
  - `class KnexStockReservationRepository implements StockReservationRepositoryPort { constructor(knex: Knex, outbox: KnexOutboxRepository) }`

Migration: table `stock_reservations` — `order_id uuid primary key`, `status string not null`, `items jsonb not null`, `created_at` / `updated_at` timestamps not null default `now`.

`save(reservation, products)` in one `knex.transaction`:
1. For each product: `update products set stock = ?, version = version + 1 where id = ? and version = ?`; 0 rows → throw `ConcurrentModificationError(\`Product ${id} was modified concurrently.\`)`.
2. Upsert the reservation row (`onConflict('order_id').merge(['status', 'items', 'updated_at'])`).
3. `outbox.append(tx, 'StockReservation', reservation.pullDomainEvents())` and `outbox.append(tx, 'Product', products.flatMap(p => p.pullDomainEvents()))`.

`findByOrderId` restores status and `items` (parse when SQLite returns a string).

- [ ] **Step 1: Write failing tests** (SQLite in-memory, migrations, as in `knex-product.repository.spec.ts`; products created through `KnexProductRepository` and approved):
  - reserve: product stock 1 and version 1 in the table; reservation found with `RESERVED` and the items; outbox has `catalog.stock.reserved.v1` (aggregate_type `StockReservation`, aggregate_id = orderId) and `catalog.product.stock-changed.v1` (aggregate_type `Product`)
  - release after reserve: same row, status `RELEASED`, stock restored, version 2
  - stale version: load product, bump `version` directly in the table, save → rejects with `ConcurrentModificationError`; stock unchanged, no reservation row, no new outbox rows
  - reject with no products: reservation `REJECTED`, outbox has `catalog.stock.insufficient.v1`
  - `findByOrderId` of unknown order → `null`

- [ ] **Step 2: Run `npx jest src/infra/persistence/knex-stock-reservation` — expect FAIL.**

- [ ] **Step 3: Implement** migration, error, repository.

- [ ] **Step 4: Run `npm test && npm run typecheck` — expect PASS.**

- [ ] **Step 5: Commit** `feat(catalog): persiste reserva de estoque com lock otimista`

---

### Task 5: `OrderStockConsumer`, wiring, topics, docs

**Files:**
- Create: `src/infra/messaging/order-stock.consumer.ts`
- Create: `src/infra/messaging/dead-letter.ts`
- Create: `docs/stock-demo.md` (in `catalog-service/docs/`)
- Modify: `src/infra/messaging/product-analysis.consumer.ts` (use `dead-letter.ts`)
- Modify: `src/infra/messaging/kafka.config.ts`, `src/infra/config/env.ts`, `src/infra/product.factory.ts`, `src/main.ts`
- Modify: `.env.example`, `CLAUDE.md` (catalog-service), `../docker/kafka/create-topics.sh`
- Test: `src/infra/messaging/order-stock.consumer.spec.ts`, `src/infra/config/env.spec.ts`; existing `product-analysis.consumer.spec.ts` must stay green

**Interfaces:**
- Consumes: `ReserveStockPort`, `ReleaseStockPort` (Task 3), `KnexStockReservationRepository` (Task 4), `toStockIntegrationEvent` (Task 2).
- Produces:
  - `sendToDeadLetter(producer: Producer, deadLetterTopic: string, payload: EachMessagePayload, reason: string): Promise<void>` — the current private method of `ProductAnalysisConsumer`, same `dlq-*` headers.
  - `interface OrderStockTopics { placedTopic: string; cancelledTopic: string; deadLetterTopic: string }`
  - `class OrderStockConsumer { constructor(reserveStockPort, releaseStockPort, consumer: Consumer, producer: Producer, topics: OrderStockTopics, logger: Logger); start(): Promise<void> }`
  - `configureKafka` returns `{ producer, consumer, orderStockConsumer }`, the last with `groupId: "catalog-service-order-stock"`.
  - `AppConfig` gains `orderPlacedTopic`, `orderCancelledTopic`, `orderStockDeadLetterTopic`.
  - `ProductModule` gains `orderStockConsumer: OrderStockConsumer`; `ProductModuleProps` gains `orderStockKafkaConsumer: Consumer` and `orderStockTopics: OrderStockTopics`.

zod schemas (DLQ when they fail):
```ts
const placedSchema = z.object({
    orderId: z.uuid(),
    items: z.array(z.object({ sku: z.string().min(1), quantity: z.number().int().positive() })).min(1),
});
const cancelledSchema = z.object({ orderId: z.uuid(), reason: z.string().optional() });
```

- [ ] **Step 1: Write failing tests** in the style of `product-analysis.consumer.spec.ts`:
  - subscribes to both topics with `fromBeginning: true`
  - placed → `reserve({ orderId, items })`; extra fields ignored; malformed SKU string `"sku 1!"` passed through to `reserve` (not DLQ)
  - cancelled → `release({ orderId })`, `reason` not forwarded
  - DLQ with `dlq-original-topic` / `dlq-reason` for: null value, invalid JSON, non-UUID `orderId`, empty `items`, `quantity: 0`, and a `DomainError` thrown by the port
  - a plain `Error` (e.g. `ConcurrentModificationError`) from the port is rethrown, not sent to DLQ
  - `env.spec.ts`: the three new defaults and overrides

- [ ] **Step 2: Run `npx jest src/infra/messaging src/infra/config` — expect FAIL.**

- [ ] **Step 3: Implement** consumer and `dead-letter.ts` (refactor `ProductAnalysisConsumer` to use it), config, `configureKafka`, factory (one `StockFacade` with `KnexProductRepository` and `KnexStockReservationRepository`; outbox for stock repo built with `toStockIntegrationEvent`), `main.ts` (start after `productAnalysisConsumer.start()`, disconnect in `shutdown` before `relay.stop()`).

- [ ] **Step 4: Topics, env, docs**
  - `create-topics.sh`: under the catalog block add `catalog.stock.reserved.v1`, `catalog.stock.insufficient.v1`, `catalog.product.stock-changed.v1` (3) and `catalog.order-stock.dlq 1 retention.ms=1209600000 # 14 days to inspect and replay`; new `# order-service (consumed by catalog-service until order-service exists)` block with `order.order.placed.v1` and `order.order.cancelled.v1` (3).
  - `.env.example` and `catalog-service/CLAUDE.md` Kafka env list: the three new vars.
  - `docs/stock-demo.md`: the 4 demo steps from the spec, with
    ```bash
    docker exec -i kafka /opt/kafka/bin/kafka-console-producer.sh --bootstrap-server kafka:19092 \
      --topic order.order.placed.v1 --property parse.key=true --property key.separator='|' <<'EOF'
    6f1c2b8e-0000-4000-8000-000000000001|{"orderId":"6f1c2b8e-0000-4000-8000-000000000001","items":[{"sku":"NB-001","quantity":1}]}
    EOF
    ```
    and `curl localhost:8082/products/sku/NB-001` (check the real route in `product.routes.ts`) plus Kafka UI (http://localhost:8090) as alternative.

- [ ] **Step 5: Run `npm test && npm run typecheck && npm run build` — expect PASS.**

- [ ] **Step 6: Commit** `feat(catalog): consome eventos de pedido e publica eventos de estoque`

---

### Task 6: End-to-end check against the local stack

- [ ] **Step 1:** From the repo root: `docker compose up -d` then `docker compose up -d kafka-init`; in `catalog-service/`: `npm run migrate && npm run dev`.
- [ ] **Step 2:** Create a product with stock 2 (`POST /products`), approve it (publish `{"sku":"…","status":"APPROVED"}` to `produto.analisado.v1`), then run the 4 demo steps from `docs/stock-demo.md`.
- [ ] **Step 3:** Expected: stock 2 → 1 → (rejected, still 1) → 0 → 1 after cancel; `kafka-console-consumer.sh --from-beginning` on the three `catalog.*` topics shows `reserved`, `insufficient`, `stock-changed` with stock 1, 0, 1. Record the output in the PR description.
- [ ] **Step 4:** If anything differs, fix it in the owning task's files with a test first, and commit.
