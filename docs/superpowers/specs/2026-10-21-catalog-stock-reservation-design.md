# catalog-service: stock reservation from orders — design

Date: 2026-10-21
Status: awaiting review
Issue: #30 (depends on ADR #10, feeds #33 and #8)

## Goal

`catalog-service` stays the owner of product stock (option "catalog owns stock" of ADR #10, chosen ahead of the ADR being accepted). It reacts to order events with a choreographed saga: it debits stock when an order is placed, gives it back when the order is cancelled, and tells the order-service and the marketplace-gateway what happened.

Success means, in the demo flow (a product starting with 2 units):

1. An order for 1 unit debits stock (2 → 1). The catalog publishes `catalog.stock.reserved.v1` (order-service confirms the order) and `catalog.product.stock-changed.v1` with `stock: 1` (marketplace-gateway updates the listing).
2. An order for 2 units leaves stock untouched and publishes `catalog.stock.insufficient.v1` (order-service cancels the order).
3. Another order for 1 unit brings stock to 0. `stock-changed` goes out with `stock: 0` and the gateway zeroes availability.
4. `order.order.cancelled.v1` for an order that had been reserved gives the stock back and publishes `stock-changed` again.

The order-service does not exist yet, so the demo publishes the order events by hand (see "Demo").

## Non-goals

- Reservations with expiry (hold now, commit later). Stock is debited on `placed` and returned on `cancelled`; a timed hold doubles the work without changing what the demo shows.
- Changing stock through HTTP (restock endpoint). Out of scope for #30.
- Writing ADR #10 or `docs/eventos.md` (#8). This work proposes the contracts; their owners record them.
- Removing `stock` from `catalog.product.created.v1` (it stays as the initial stock).

## Anti-goals

- A redelivered order event must never debit or return stock twice.
- An order with several items must never be partially reserved.
- Two orders for the same SKU processed concurrently must never oversell (stock below zero or lost update).

## Decisions

| Topic | Decision |
|---|---|
| Saga style | Choreography over Kafka, catalog as stock owner |
| Reservation | Debit on `order.order.placed.v1`, return on `order.order.cancelled.v1` |
| Multi-item orders | All or nothing, one DB transaction |
| Idempotency | Per order, through a `StockReservation` aggregate keyed by `orderId` (see below) |
| Concurrency | Optimistic locking: `version` column on `products` |
| Publishing | Outbox (ADR-0002), same transaction as the stock change |
| Inbound format | CloudEvents binary mode: event data is the JSON value, attributes in `ce_*` headers |
| Invalid messages | Dead letter topic `catalog.order-stock.dlq`, same pattern as `ProductAnalysisConsumer` |

## Contracts

All topics have 3 partitions, except the DLQ (1 partition, 14 days retention, like the existing DLQs). All are added to `docker/kafka/create-topics.sh`. The two `order.*` topics are created there under an `# order-service` comment (the order-service will own them; creating them now lets the demo run).

### Consumed (provisional, owned by order-service)

`order.order.placed.v1`, key `orderId`:

```json
{ "orderId": "6f1c…-uuid", "items": [{ "sku": "SKU-001", "quantity": 1 }] }
```

`order.order.cancelled.v1`, key `orderId`:

```json
{ "orderId": "6f1c…-uuid", "reason": "PAYMENT_FAILED" }
```

`reason` is optional and only logged. `orderId` must be a UUID (the outbox stores `aggregate_id` as `uuid`). `items` must be non-empty, each `quantity` a positive integer; the same SKU twice in one order is summed. `reserved` echoes the summed lines.

What goes to the DLQ and what gets an answer (design call, from the review):

- **DLQ:** the message breaks the contract: not JSON, missing or non-UUID `orderId`, empty `items`, missing `sku`, `quantity` not a positive integer. The order-service sent something it should never send; no answer is published.
- **`insufficient`:** the contract holds but a line can't be served: SKU unknown, not approved, short on stock, or a string that is not a valid `Sku` (it can't match any product, so it is treated as unknown with `available: 0`). The shortage keeps the SKU as the raw string from the message.

### Published

`catalog.stock.reserved.v1`, key `orderId`:

```json
{ "orderId": "…", "items": [{ "sku": "SKU-001", "quantity": 1 }] }
```

`catalog.stock.insufficient.v1`, key `orderId`. Lists every item that could not be served:

```json
{ "orderId": "…", "items": [{ "sku": "SKU-001", "requested": 2, "available": 1 }] }
```

`catalog.product.stock-changed.v1`, key `productId`. One per product whose stock changed (on reserve and on release):

```json
{ "productId": "…", "sku": "SKU-001", "stock": 1 }
```

`stock` is the new absolute value, not a delta, so a consumer that sees events out of order or twice still converges on the latest value it applies.

## Domain

### Product

- `ProductEntity` gains a `version` (number, restored from the row, starts at 0). The entity does not increment it; the repository does (see Persistence).
- `removeStock` / `addStock` record a `ProductStockChanged(productId, sku, stock)` domain event.
- A product is **available for orders** only when its analysis is `APPROVED`. An order line for a product that is unknown or not approved is treated as insufficient with `available: 0`. (Marketplaces only list approved products, so this only happens with a bad or hand-made event.)

### StockReservation (new aggregate, `core/stock-reservation/` or inside `core/product/` — builder's call)

One per order, id = `orderId`.

- Fields: `orderId`, `items: {sku, quantity}[]`, `status: RESERVED | REJECTED | RELEASED | CANCELLED`.
- `StockReservation.reserve(orderId, items)` → status `RESERVED`, records `StockReserved(orderId, items)`.
- `StockReservation.reject(orderId, shortages)` → status `REJECTED`, records `StockInsufficient(orderId, shortages)`.
- `release()` → only from `RESERVED`, status `RELEASED`, records nothing itself (the products record `ProductStockChanged`). From `REJECTED`, `RELEASED` or `CANCELLED` it is a no-op.
- `StockReservation.cancelBeforePlaced(orderId)` → status `CANCELLED`, empty `items`, records nothing. A tombstone (see below).

Recording the rejected reservation too means a redelivered `placed` for a rejected order does not re-evaluate stock (which might have changed) and does not publish a second, possibly contradicting, answer.

**Cancel before placed.** `placed` and `cancelled` are different topics, so Kafka does not guarantee `placed` is consumed first even with the same key. If a `cancelled` finds no reservation, the catalog stores a `CANCELLED` tombstone. A `placed` arriving later finds a reservation (step 1 of `reserve`) and does nothing, so no stock leaks. The catalog publishes nothing for it: the order-service already cancelled the order. (Design call, from the review.)

### Facade use cases (new `port/in`)

`ReserveStockPort.reserve({ orderId, items })`:

1. If a reservation for `orderId` exists → return (idempotent, nothing published).
2. Load the products for the SKUs.
3. Compute shortages (unknown, not approved, or `stock < quantity`).
4. If any shortage → save `StockReservation.reject(...)` (no product change).
5. Else → `removeStock` on each product, save the products and `StockReservation.reserve(...)` together.

`ReleaseStockPort.release({ orderId })`:

1. No reservation for `orderId` → save the `CANCELLED` tombstone and return. Logged at info.
2. Reservation not `RESERVED` → return.
3. `addStock` on each product, `release()` the reservation, save together.

Both steps 4/5 and release step 3 must be **one transaction**: product rows, reservation row and outbox rows commit or fail together.

## Persistence

Migrations (expand only, backward compatible with the running version):

1. `add_version_to_products`: `version integer not null default 0`.
2. `create_stock_reservations`: `order_id uuid primary key`, `status varchar not null`, `items jsonb not null`, `created_at`, `updated_at`.

Repository:

- Product writes become optimistic: `UPDATE products SET …, version = version + 1 WHERE id = ? AND version = ?`. Zero rows updated → throw a `ConcurrentModificationError`. This is an infrastructure error, **not** a `DomainError`, so the consumer rethrows it and Kafka redelivers the message; the retry reloads fresh stock. Inserts of new products (create/import) keep using `insert`.
- The existing `save`/`saveAll` (`insert … onConflict('id').merge()`) is used for create, import and analysis completion. Builder's call whether to move those to the versioned update as well; at minimum the stock path must be versioned. Analysis completion and stock changes on the same product racing each other would otherwise lose an update, so moving `save` of existing products to the versioned update is preferred.
- A new port lets the facade save products and the reservation in one transaction (e.g. `StockReservationRepositoryPort.save(reservation, products)`, or a unit-of-work). Builder's call on the shape; the transaction and outbox append are required. Outbox `aggregate_type` is `StockReservation` for reservation events and `Product` for stock-changed.
- **Known limit, rolling deploy:** while an old instance (without `version`) and a new one run together, the old `save` can overwrite a stock change. Accepted: the demo runs one instance, and the window closes once the old version is gone. No trigger. (Design call, from the review.)
- `insert` of a reservation whose `order_id` already exists (two concurrent deliveries of the same `placed`) → primary key violation → treated like a concurrent modification (rethrow, redeliver; the retry hits step 1 and returns).

## Messaging

- `OrderStockConsumer` in `infra/messaging/`, modelled on `ProductAnalysisConsumer`: zod schemas per topic (anticorruption layer), routes `placed` to `reserve` and `cancelled` to `release`, sends unparseable messages and `DomainError`s to `catalog.order-stock.dlq` with the `dlq-*` headers, rethrows anything else.
- It uses its **own consumer group** (`catalog-service-order-stock`), separate from the analysis consumer, so a stuck order message does not block analysis results and vice versa. `configureKafka` gains a way to build a second consumer.
- Mapping in `product.integration-events.ts` (or a sibling file) for `StockReserved`, `StockInsufficient`, `ProductStockChanged`.
- Config (`env.ts`, `.env.example`, `CLAUDE.md`): `ORDER_PLACED_TOPIC` (`order.order.placed.v1`), `ORDER_CANCELLED_TOPIC` (`order.order.cancelled.v1`), `ORDER_STOCK_DLQ_TOPIC` (`catalog.order-stock.dlq`).
- Wiring in `product.factory.ts` and `main.ts` (start and graceful shutdown of the new consumer).

## Tests

- Unit: `ProductEntity` stock events and version; `StockReservation` transitions; facade `reserve`/`release` with in-memory fakes (happy path, insufficient, unknown and unapproved SKU, multi-item all-or-nothing, duplicate SKU lines summed, redelivered placed, cancel of rejected/unknown/already released order, cancel then placed leaves stock untouched, malformed SKU string answered as insufficient).
- Adapter: repository optimistic lock and reservation transaction against Postgres (Testcontainers, like `outbox-relay.spec.ts`, since it needs `jsonb` and real row-level behaviour); consumer routing and DLQ with fakes (like `product-analysis.consumer.spec.ts`).
- Integration events mapping spec.

## Demo

A short section in `catalog-service/README.md` (or root README, builder's call) showing how to publish `order.order.placed.v1` / `order.order.cancelled.v1` by hand, using `kafka-console-producer.sh` inside the `kafka` container with a key, plus the Kafka UI alternative. Headers are optional for the consumer (it reads only the value).

## Follow-ups outside this repo change

- Comment on #8 with the five contracts above so the owners can adopt them in `docs/eventos.md`.
- Comment on #10 noting the implementation assumed "catalog owns stock".
- #33 consumes `catalog.product.stock-changed.v1`.

## Left to the builder

- Folder for the reservation aggregate; port shape for the transactional save.
- Whether existing `save` for already-persisted products also moves to the versioned update (preferred).
- Exact file split of the integration event mappers.
