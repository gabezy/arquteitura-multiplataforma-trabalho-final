# Receive marketplace orders Specification

Issue: #20 · Owner: Rodrigo Pretes Maia · Date: 2026-10-24
Copy kept in sync at `docs/specs/order-service/pedidos/spec.md`; this file is the source.

## Problem Statement

The marketplace-gateway (#22) already polls the marketplaces and publishes `marketplace.order.received.v1`, the catalog (#30) waits for `order.order.placed.v1` to reserve stock, and the BFF (#24) already calls `GET /orders` on the order-service with the `rest` gateway as default. The order-service has no domain yet, so the order chain of the 28/10 demo (act 6) stops at the gateway and `GET /orders` on the BFF answers 503. This feature turns each received order into a persisted `Order`, asks the catalog for the stock reservation and serves the orders to the BFF. Stock responses and payment events come in #29.

## Goals

- [ ] An order polled by the marketplace-gateway from a WireMock simulator becomes one row in `orders` and one `order.order.placed.v1` on Kafka, which the catalog answers with `catalog.stock.reserved.v1` or `insufficient.v1`.
- [ ] Redelivering the same `marketplace.order.received.v1`, or receiving the same marketplace order under another `ce_id`, leaves exactly one order and one `placed` event.
- [ ] `GET /orders` and `GET /orders/{id}` through the BFF answer 200 with the shape in `docs/api-do-bff.md`.
- [ ] A message outside the contract ends in `order.marketplace-order.dlq` and does not stop the consumer.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Consumers of `catalog.stock.reserved.v1` / `insufficient.v1`, transitions to `CONFIRMED` and `CANCELLED(OUT_OF_STOCK)`, `order.order.confirmed.v1` and `order.order.cancelled.v1` | #29 (separate branch and PR) |
| Consumers of `billing.payment.confirmed.v1` / `failed.v1`, transitions to `PAID` and `CANCELLED(PAYMENT_FAILED)` | #29, right after the stock responses: payment only exists for a confirmed order |
| DLQs `order.stock-response.dlq` and `order.billing-payment.dlq` | Come with their consumers in #29 |
| `GET /reports/sales-by-marketplace` | #31 |
| Cancellation by the buyer at the marketplace (`MARKETPLACE_CANCELLED`) | The gateway does not publish it (#22) |
| Buyer and shipping data | Not in the `received` contract; no service needs them yet (`docs/eventos.md`) |
| Script that publishes a received order by hand (Plano B) | The gateway publishes real orders; the Kafka UI covers a manual publish in the demo |
| Authentication on the order-service API | Internal services do not check tokens; the BFF authorizes by role (ADR-0009) |
| Changing the billing rule for items priced 0 | billing-service belongs to @paulnune; proposed to him separately |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Branching | `feature/20-receber-pedidos` now, `feature/29-...` afterwards, one PR each to `dev` | Same pattern as the remote repository | y |
| Order total | `total = Σ quantity × unitPrice`, computed in cents; the `total` of the message is only compared, and a difference is logged as `warn` with both values | The billing rejects a `confirmed` whose total differs from the items (#23); the user chose the items as the source | y |
| Money representation | `decimal(14,2)` columns in Postgres (same as catalog and gateway); a `Money` value object in the domain that holds integer cents and does every sum and product; JSON values are numbers in reais with at most 2 decimals | `numeric` is exact in Postgres and keeps #31 sums in SQL exact and the tables readable; a JS `number` is only exact for integers, so `quantity × unitPrice` in reais drifts (`3 × 0.1 = 0.30000000000000004`) and the billing `ParseMoney` rejects it | y |
| `unitPrice` with more than 2 decimals | The message goes to the DLQ | It has no exact value in reais; the billing would reject it later anyway | y |
| `unitPrice` equal to 0 | Accepted (bonus item); known limitation: the billing (#23) requires ≥ 0.01 and would send the `confirmed` to its DLQ in #29 | The user sees bonus items as legitimate; the fix belongs to the billing contract, proposed to @paulnune | y |
| Billing upper bounds (100 items, quantity 10 000, unitPrice 1 000 000.00) | Not enforced at intake | Not part of the `received` contract; the simulators stay far below; same known limitation as the 0 price | y |
| Idempotency | Unique `(marketplace, external_order_id)` in `orders` and the `ce_id` in `processed_events`, both written in the transaction that saves the order and appends to the outbox | Survives a crash between processing and the offset commit, and a re-publication with a new `ce_id` (`docs/eventos.md`) | y |
| Same marketplace order with different content | The first one wins; the later one is skipped and logged as `info` | The gateway never publishes an order twice (#22); a changed order at the marketplace is out of scope | y |
| Message without `ce_id` | Processed; deduplicated only by the business key | The business key is the real idempotency key; the gateway always sends `ce_id` | y |
| Consumer group | `order-service-marketplace-orders`, `fromBeginning: true` | One group per source topic, so each DLQ maps to one group (`docs/eventos.md`); `fromBeginning` so orders published before the first start are not lost | y |
| Order id | UUID v4 generated by the order-service at receipt | `marketplace.order.received.v1` has no internal id; the catalog and the billing require a UUID | y |
| `order.order.placed.v1` payload | `orderId`, `marketplace`, `externalOrderId`, `items[{sku, quantity, unitPrice}]` | The catalog requires `orderId` and `items[{sku, quantity}]` and ignores unknown fields; the optional fields help #29 and the traces (`docs/eventos.md`) | y |
| SKU | Trimmed and stored as received; case is not changed | The catalog normalizes the SKU (#30); the order shows what the marketplace sold | y |
| States in #20 | The status column and the API accept `RECEIVED`, `CONFIRMED`, `PAID`, `CANCELLED`; #20 only creates `RECEIVED` | The BFF filter and enum use the four values; the transitions and their guards come with their triggers in #29 | y |
| Timestamps | `createdAt` and `updatedAt` are when the order-service saved the order; the marketplace date is kept as `orderedAt` and also returned by the API | The BFF reads `createdAt`/`updatedAt` (ignores unknown fields); #31 may need `orderedAt` | y |
| API errors | Invalid query or path parameter → 422 `application/problem+json`; unknown id → 404 | Existing error handler categories; the BFF turns 400/422 into its own 400 and 404 into 404 | y |
| List order | `createdAt` descending, then `id` descending | The BFF mock and doc promise newest first; `id` makes pages stable | y |
| Contract approval | Mark `marketplace.order.received.v1`, `order.order.placed.v1` and the BFF → order REST call as Implementado in `docs/eventos.md` in the same PR | The owner of the consumer side (us) approves by implementing; both sides then exist | y |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: A received marketplace order becomes an order ⭐ MVP

**User Story**: As the store (persona `store`), I want each order sold on Amazon, Mercado Livre or Shopee to become an order in the Omni Market so that its stock is reserved and it can be followed and billed.

**Why P1**: #20 acceptance criterion and the start of act 6 of the demo.

**Acceptance Criteria**:

1. WHEN a valid `marketplace.order.received.v1` arrives THEN the order-service SHALL save one order with a new UUID, the message's `marketplace`, `externalOrderId`, `orderedAt` and items, status `RECEIVED` and `cancellationReason` null.  <!-- event-driven -->
2. WHEN the order is saved THEN the order-service SHALL set its total to the sum of `quantity × unitPrice` of its items, rounded to the cent.  <!-- event-driven -->
3. WHEN the order is saved THEN the order-service SHALL append `order.order.placed.v1` with key `orderId` and payload `{ orderId, marketplace, externalOrderId, items: [{ sku, quantity, unitPrice }] }` to the outbox in the same transaction.  <!-- event-driven -->
4. IF saving the order, the inbox row or the outbox row fails THEN the order-service SHALL write none of the three and SHALL rethrow the error so Kafka redelivers the message.  <!-- unwanted -->
5. WHEN the `total` of the message differs from the computed total THEN the order-service SHALL keep the computed total and SHALL log a `warn` with `marketplace`, `externalOrderId`, both totals and no other message content.  <!-- event-driven -->
6. WHEN an item has `unitPrice` 0 THEN the order-service SHALL accept the item and include it in the order and in `placed` with `unitPrice` 0.  <!-- event-driven -->
7. WHEN `placed` is published THEN the message SHALL carry the `traceparent` of the trace in which the received message was handled.  <!-- event-driven -->

**Independent Test**: publish a `marketplace.order.received.v1` (from the gateway or the Kafka UI); `select * from orders` shows one `RECEIVED` row and the Kafka UI shows one `order.order.placed.v1` with the same `orderId`, followed by a `catalog.stock.*` answer.

---

### P1: Redelivery does not duplicate the order ⭐ MVP

**User Story**: As the store, I want a redelivered or re-published order to be counted once so that stock is not reserved twice and the reports stay right.

**Why P1**: second acceptance criterion of #20; delivery is at-least-once.

**Acceptance Criteria**:

1. WHEN a message whose `ce_id` is already in `processed_events` arrives THEN the order-service SHALL save nothing, append nothing to the outbox and log `info` with the `ce_id`.  <!-- event-driven -->
2. WHEN a message with a new `ce_id` arrives for a `marketplace` + `externalOrderId` that already has an order THEN the order-service SHALL keep the existing order unchanged, append nothing to the outbox and record the new `ce_id` in `processed_events`.  <!-- event-driven -->
3. WHEN two messages for the same `marketplace` + `externalOrderId` are handled at the same time THEN the order-service SHALL keep exactly one order and one `placed` event.  <!-- event-driven -->
4. The order-service SHALL allow at most one order per `marketplace` + `externalOrderId`, enforced by a unique constraint in Postgres.  <!-- ubiquitous -->

**Independent Test**: publish the same message twice, then once more with another `ce_id`; `orders` has one row and the outbox has one `placed`.

---

### P1: Messages outside the contract go to the DLQ ⭐ MVP

**User Story**: As the operator of the environment, I want a message that can never be processed to be parked so that it can be inspected and the next orders keep flowing.

**Why P1**: #20 task "DLQ para mensagens que nunca vão ser processadas"; a poison message would otherwise block the partition.

**Acceptance Criteria**:

1. IF the message value is empty or not valid JSON THEN the order-service SHALL publish the message to `order.marketplace-order.dlq` with its original key, value and headers plus `dlq-original-topic`, `dlq-original-partition`, `dlq-original-offset` and `dlq-reason`, and save no order.  <!-- unwanted -->
2. IF `marketplace` is not `AMAZON`, `MERCADO_LIVRE` or `SHOPEE`, or `externalOrderId` is missing or blank after trimming THEN the order-service SHALL send the message to the DLQ and save no order.  <!-- unwanted -->
3. IF `items` is missing or empty, or an item has a blank `sku`, a `quantity` that is not an integer greater than 0, or a `unitPrice` that is negative, not a number or has more than 2 decimals THEN the order-service SHALL send the message to the DLQ and save no order.  <!-- unwanted -->
4. IF `orderedAt` is not an ISO-8601 instant, or `total` is not a number THEN the order-service SHALL send the message to the DLQ and save no order.  <!-- unwanted -->
5. WHEN a message is sent to the DLQ THEN the order-service SHALL record its `ce_id` in `processed_events` (when present), log a `warn` with topic, partition, offset and reason, and go on with the next message.  <!-- event-driven -->
6. IF the database or Kafka fails while a message is handled THEN the order-service SHALL rethrow the error, SHALL NOT send the message to the DLQ, and Kafka SHALL redeliver it.  <!-- unwanted -->

**Independent Test**: publish `{}` and a message with `marketplace: "EBAY"` to `marketplace.order.received.v1`; both appear in `order.marketplace-order.dlq` with `dlq-reason`, and a valid order published right after is saved.

---

### P1: The BFF lists and shows orders ⭐ MVP

**User Story**: As the store or the CSM, I want to list and open the orders in the BFF so that I can follow each sale per marketplace.

**Why P1**: the BFF (#24) already calls these routes; without them `GET /orders` answers 503 in the demo.

**Acceptance Criteria**:

1. WHEN `GET /orders` is called THEN the order-service SHALL answer 200 with `{ "orders": [...], "limit": <n>, "offset": <n> }`, orders sorted by `createdAt` descending and then by `id` descending.  <!-- event-driven -->
2. The order-service SHALL represent each order as `{ id, marketplace, externalOrderId, status, total, items: [{ sku, quantity, unitPrice }], cancellationReason, orderedAt, createdAt, updatedAt }`, with money as JSON numbers in reais and instants as ISO-8601 in UTC.  <!-- ubiquitous -->
3. WHEN `marketplace` and/or `status` are given THEN the order-service SHALL return only the orders that match all given filters.  <!-- event-driven -->
4. WHEN `limit` or `offset` is omitted THEN the order-service SHALL use `limit` 20 and `offset` 0 and echo them in the response.  <!-- event-driven -->
5. IF `limit` is not an integer from 1 to 100, `offset` is not an integer ≥ 0, `marketplace` is not one of the three values, or `status` is not `RECEIVED`, `CONFIRMED`, `PAID` or `CANCELLED` THEN the order-service SHALL answer 422 in `application/problem+json`.  <!-- unwanted -->
6. WHEN `GET /orders/{id}` is called with the id of an existing order THEN the order-service SHALL answer 200 with that order in the shape of AC 2.  <!-- event-driven -->
7. IF `GET /orders/{id}` is called with an id that is not a UUID THEN the order-service SHALL answer 422 in `application/problem+json`.  <!-- unwanted -->
8. IF `GET /orders/{id}` is called with a UUID that has no order THEN the order-service SHALL answer 404 in `application/problem+json`.  <!-- unwanted -->

**Independent Test**: with the stack up, `curl -H "Authorization: Bearer $CSM" localhost:8080/orders` through the BFF returns the order created by the first story.

---

### P2: The consumer runs with the service lifecycle

**User Story**: As the operator of the environment, I want the consumer to start and stop with the service so that no order is lost or half-processed on a restart.

**Why P2**: the bootstrap already covers the producer side; the consumer joins the same lifecycle.

**Acceptance Criteria**:

1. WHEN the service starts THEN it SHALL connect the consumer to group `order-service-marketplace-orders` on `marketplace.order.received.v1` before listening on its HTTP port.  <!-- event-driven -->
2. IF the consumer cannot connect to Kafka at startup THEN the service SHALL exit with code 1.  <!-- unwanted -->
3. WHEN the service receives `SIGTERM` or `SIGINT` THEN it SHALL disconnect the consumer before it stops the relay, disconnects the producer and closes the database pool.  <!-- event-driven -->
4. The compose and `docker/kafka/create-topics.sh` SHALL create `order.marketplace-order.dlq` with 1 partition and `retention.ms=1209600000`.  <!-- ubiquitous -->

**Independent Test**: `docker compose up -d kafka-init` lists `order.marketplace-order.dlq`; `docker restart order-service` logs the consumer joining the group and then the shutdown order.

---

## Edge Cases

- WHEN the same SKU appears in two lines THEN the order-service SHALL keep both lines as received (the catalog sums them).
- WHEN an item `sku` has spaces around it THEN the order-service SHALL store it trimmed.
- IF a message arrives with extra fields unknown to the contract THEN the order-service SHALL ignore those fields and process the message.
- WHEN `GET /orders` is called with an `offset` past the last order THEN the order-service SHALL answer 200 with an empty `orders` array.

---

## Implicit-requirement sweep

| Dimension | Coverage |
| --- | --- |
| Input validation & bounds | ORDER-12..15, ORDER-22, ORDER-24 |
| Failure / partial-failure states | ORDER-04, ORDER-17 |
| Idempotency / retry / duplicate handling | ORDER-08..11 |
| Auth boundaries & rate limits | N/A because the BFF authorizes by role and internal services do not check tokens (ADR-0009) |
| Concurrency / ordering | ORDER-10, ORDER-11 |
| Data lifecycle / expiry | N/A because orders are never deleted in this scope and `processed_events` cleanup is not decided for any service |
| Observability | ORDER-05, ORDER-07, ORDER-16 |
| External-dependency failure | ORDER-17, ORDER-27 |
| State-transition integrity | N/A in #20 because only `RECEIVED` is created; the transitions and their guards are #29 |

---

## Requirement Traceability

| Requirement ID | Story | Tasks | Status |
| --- | --- | --- | --- |
| ORDER-01 | P1: received order becomes an order (AC 1) | T1, T2 | Implementing |
| ORDER-02 | P1: received order becomes an order (AC 2) | T1 | Implementing |
| ORDER-03 | P1: received order becomes an order (AC 3) | T3 | Implementing |
| ORDER-04 | P1: received order becomes an order (AC 4) | T3 | Implementing |
| ORDER-05 | P1: received order becomes an order (AC 5) | T5 | In Tasks |
| ORDER-06 | P1: received order becomes an order (AC 6) | T1 | Implementing |
| ORDER-07 | P1: received order becomes an order (AC 7) | T5, T7 | In Tasks |
| ORDER-08 | P1: redelivery (AC 1) | T3, T5 | Implementing |
| ORDER-09 | P1: redelivery (AC 2) | T2, T3 | Implementing |
| ORDER-10 | P1: redelivery (AC 3) | T3 | Implementing |
| ORDER-11 | P1: redelivery (AC 4) | T3 | Implementing |
| ORDER-12 | P1: DLQ (AC 1) | T5 | In Tasks |
| ORDER-13 | P1: DLQ (AC 2) | T5 | In Tasks |
| ORDER-14 | P1: DLQ (AC 3) | T5 | In Tasks |
| ORDER-15 | P1: DLQ (AC 4) | T5 | In Tasks |
| ORDER-16 | P1: DLQ (AC 5) | T5 | In Tasks |
| ORDER-17 | P1: DLQ (AC 6) | T5 | In Tasks |
| ORDER-18 | P1: API (AC 1) | T4, T6 | Implementing |
| ORDER-19 | P1: API (AC 2) | T6 | In Tasks |
| ORDER-20 | P1: API (AC 3) | T4, T6 | Implementing |
| ORDER-21 | P1: API (AC 4) | T4, T6 | Implementing |
| ORDER-22 | P1: API (AC 5) | T6 | In Tasks |
| ORDER-23 | P1: API (AC 6) | T2, T4, T6 | Implementing |
| ORDER-24 | P1: API (AC 7) | T6 | In Tasks |
| ORDER-25 | P1: API (AC 8) | T2, T4, T6 | Implementing |
| ORDER-26 | P2: lifecycle (AC 1) | T7 | In Tasks |
| ORDER-27 | P2: lifecycle (AC 2) | T7 | In Tasks |
| ORDER-28 | P2: lifecycle (AC 3) | T7 | In Tasks |
| ORDER-29 | P2: lifecycle (AC 4) | T7 | In Tasks |

**Coverage:** 29 total, 29 mapped to tasks, 0 unmapped

---

## Success Criteria

- [ ] With `make up` and a simulator order, the order reaches `RECEIVED` in `orders` and the catalog answers its `placed` within 5 s.
- [ ] Publishing the same received order 3 times leaves 1 row in `orders` and 1 `placed` in the outbox.
- [ ] `GET /orders` through the BFF answers 200 for `admin`, `store` and `csm` with real orders.
- [ ] CI of `order-service` is green with the new unit and Testcontainers tests.
