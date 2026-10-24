# order-service orders Specification

Copy kept in sync at `docs/specs/order-service/orders/spec.md`; this file is the source.

Issues: #20 (receive the marketplace orders and the order life cycle), #29 (stock reservation in the order), #31 (sales reports by marketplace) and the order-service share of #14 (topics and dead letter topics). Decisions: ADR-0004 (the catalog owns the stock, reservation by choreography), ADR-0002 (outbox). It builds on the bootstrap of #15 (`.specs/features/order-service-bootstrap/`).

## Problem Statement

The order-service has a running skeleton (config, health, Postgres, outbox relay) and no domain. Nobody publishes `order.order.placed.v1` or `order.order.confirmed.v1`, so the catalog never reserves stock, the billing-service never charges and the demo flow of the event catalog (`docs/eventos.md`) stops at the marketplace. This feature gives the service its `Order` aggregate and closes the loop of ADR-0004: it turns `marketplace.order.received.v1` into an order, asks the catalog for the stock, confirms or cancels the order from the answer, follows the payment result of the billing-service, answers the BFF (#24) and reports sales by marketplace (#31).

## Goals

- [ ] An order simulated at a marketplace becomes one persisted order and one `order.order.placed.v1`, even when Kafka redelivers the message.
- [ ] The order follows the stock answer and the payment result to `CONFIRMED`, `PAID` or `CANCELLED`, and publishes `order.order.confirmed.v1` and `order.order.cancelled.v1` as the event catalog defines them, so the catalog, the billing-service and the marketplace-gateway react.
- [ ] The BFF lists and reads orders and gets the sales report by marketplace, and the report matches the orders of the demo.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Buyer-initiated cancellation at the marketplace (`MARKETPLACE_CANCELLED`) | No event carries it yet (#22 only cancels at the marketplace); the reason is accepted by the model and the API but nothing produces it |
| Buyer and shipping data | The `marketplace.order.received.v1` contract leaves them out until a service needs them (`docs/eventos.md`) |
| Reservation expiry and a timeout for a stock answer | ADR-0004: the order waits for the catalog; the answer is guaranteed by at-least-once delivery and the outbox |
| Refund of a paid order that is cancelled later | The billing-service keeps the invoice paid and logs a warning (ADR-0005) |
| Authentication and authorization | The BFF is the resource server; internal services do not check tokens (`docs/adr/0009-chamada-entre-servicos-sem-token-na-rede-interna.md`) |

---

## Assumptions & Open Questions

Every ambiguity is resolved or recorded here - nothing is left silently unclear.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Who builds it | The order-service is completed on top of what Rodrigo delivered (bootstrap #15, ADR-0004, outbox relay) | User instruction of 2026-10-24 ("conclui o order-service com o que o Rodrigo já tinha feito") | y |
| Contracts | As in `docs/eventos.md`: `marketplace.order.received.v1`, `catalog.stock.reserved.v1`, `catalog.stock.insufficient.v1`, `billing.payment.confirmed.v1`, `billing.payment.failed.v1` consumed; `order.order.placed.v1`, `order.order.confirmed.v1`, `order.order.cancelled.v1` published | The catalog of #8 is the source of truth and the other services already implement their side | y |
| Order states | `RECEIVED` → `CONFIRMED` → `PAID`, and `CANCELLED` from `RECEIVED` (no stock) or from `CONFIRMED` (payment refused) | The BFF contract lists `RECEIVED`, `CONFIRMED`, `PAID` and `CANCELLED` (`docs/api-do-bff.md`) | y |
| Cancellation reasons | `OUT_OF_STOCK`, `PAYMENT_FAILED`, `MARKETPLACE_CANCELLED` | `docs/eventos.md` | y |
| Order id | A new UUID generated when the order is persisted | The marketplace message has no internal id | n |
| Idempotency of the intake | The unique pair `marketplace` + `external_order_id` | `docs/eventos.md`: "o order-service ignora um marketplace + externalOrderId que já existe, mesmo vindo com outro ce_id" | y |
| Idempotency of the outcomes | By the state of the order: the same outcome again changes nothing; a contradicting one, or one for an unknown order, is logged as `warn` and skipped, never sent to the dead letter; the `ce_id` goes to `processed_events` after the outcome is applied or skipped | User decision of 2026-10-24 (Rodrigo): the message is valid, only the order moved on, so a dead letter would hold nothing to fix; the dead letter stays for messages out of contract. Marking after applying is safe because a redelivered outcome changes nothing | y |
| Input bounds | 1 to 100 items; quantity 1 to 10 000; unit price 0.01 to 1 000 000.00 with at most two decimals; the total of the order is the sum of quantity × unit price, and a declared total that differs is logged as `warn` and ignored; SKU with 1 to 64 characters and external order id with 1 to 100 (`docs/eventos.md`) | The billing-service sends to its dead letter the orders outside these bounds, so the order-service rejects them first, before the catalog reserves stock for an order that could never be charged. The length of the identifiers keeps the unique index and the events within what Postgres and Kafka accept: a value that broke them would fail on every redelivery | n |
| Money | Integer cents inside the service; JSON numbers with at most two decimals on the wire and in the API | Same choice as the billing-service; avoids float rounding in totals and reports | n |
| `createdAt` of an order | The `orderedAt` of the marketplace message (the date of the sale); `updatedAt` is the last change in this service | The report is by date of sale; the demo simulators date their orders | n |
| SKU | Kept as received, trimmed | The catalog already treats `nb-001` and `NB-001` as the same SKU | n |
| Consumer groups | `order-service-marketplace-orders`, `order-service-stock-response` and `order-service-billing-payment`, one dead letter topic each (`order.marketplace-order.dlq`, `order.stock-response.dlq`, `order.billing-payment.dlq`) | One group per concern, as the catalog does, so a stuck message does not hold back another flow; names from the dead letter table of `docs/eventos.md` | y |
| Pagination | `limit` 1 to 100 (default 20), `offset` ≥ 0, newest first | The BFF contract (`docs/api-do-bff.md`) | y |
| Sales report rules | Counts the orders `CONFIRMED` and `PAID` created from `from` to `to`, both inclusive, as UTC dates; one row per marketplace, with zeros when there were no sales | `docs/api-do-bff.md` (the mock counts `CONFIRMED` and `PAID`) | y |
| Validation error status | 400 for a request that breaks the shape (params, query), as the catalog-service does | The BFF turns a 400 or 422 of a service into its own 400 | n |
| Dependency | `zod` for the shape of messages and requests | Already used by the catalog-service for the same purpose; no other new dependency | n |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: Receive the marketplace order ⭐ MVP

**User Story**: As the Omni Market, I want every order received from a marketplace to become one order and ask for its stock, so that the flow continues without duplicates.

**Acceptance Criteria**:

1. WHEN a `marketplace.order.received.v1` message with a valid body arrives THEN the order-service SHALL persist a `RECEIVED` order with a new id and publish `order.order.placed.v1` with its id, marketplace, external order id and items, in the same transaction. (ORD-01)
2. WHEN a message arrives for a marketplace and external order id that already have an order THEN the order-service SHALL keep that order and publish nothing, whatever the `ce_id` of the message. (ORD-02)
3. IF two messages for the same marketplace and external order id are processed at the same time THEN the unique pair SHALL keep a single order, and the losing transaction SHALL be retried and find it. (ORD-03)
4. IF a message lacks a required CloudEvents header (`ce_specversion` 1.0, `ce_id`, `ce_source` `/marketplace-gateway`, `ce_type` equal to the topic, `ce_subject` equal to `<marketplace>:<externalOrderId>`, `ce_time`, `content-type` `application/json`), is not valid JSON, has an unknown marketplace, an external order id that is blank or longer than 100 characters, a SKU that is blank or longer than 64 characters, no items or more than 100, a quantity outside 1 to 10 000, a unit price outside 0.01 to 1 000 000.00 or with more than two decimals, or an `orderedAt` that is not an ISO-8601 time THEN the order-service SHALL publish it to `order.marketplace-order.dlq` with the `dlq-*` headers and commit its offset. (ORD-04)
6. WHEN the declared `total` differs from the sum of quantity × unit price THEN the order-service SHALL keep the sum of the items as the total of the order and log a `warn` with the marketplace, the external order id and both totals. (ORD-06)
5. IF persisting the order fails for a transient reason THEN the order-service SHALL leave the offset uncommitted so the message is delivered again, and publish nothing. (ORD-05)

**Independent Test**: Publish a `marketplace.order.received.v1` twice; one order exists and one `order.order.placed.v1` is on the topic.

---

### P1: Follow the stock answer ⭐ MVP

**User Story**: As the Omni Market, I want the order to follow the stock answer of the catalog, so that it is confirmed for the billing-service or cancelled for the marketplace.

**Acceptance Criteria**:

1. WHEN `catalog.stock.reserved.v1` arrives for a `RECEIVED` order THEN the order-service SHALL set it `CONFIRMED` and publish `order.order.confirmed.v1` with its items, its total and the time of the confirmation. (STK-01)
2. WHEN `catalog.stock.insufficient.v1` arrives for a `RECEIVED` order THEN the order-service SHALL set it `CANCELLED` with the reason `OUT_OF_STOCK` and publish `order.order.cancelled.v1` with the reason, the marketplace and the external order id. (STK-02)
3. IF an outcome that is already in the history of the order arrives again (`reserved` for an order that is `CONFIRMED`, `PAID` or cancelled for payment, which only a reserved order can be; `insufficient` for an order cancelled for lack of stock) THEN the order-service SHALL change nothing and publish nothing. (STK-03)
4. IF the outcome contradicts the history of the order (`reserved` for an order cancelled for lack of stock or by the marketplace; `insufficient` for an order that is `CONFIRMED`, `PAID`, cancelled for payment or by the marketplace), or the order is unknown, THEN the order-service SHALL change nothing, publish nothing, log a `warn` with the order id and the reason, record the `ce_id` and commit the offset without the dead letter topic. (STK-04)
5. IF a stock answer lacks a required CloudEvents header (`ce_specversion` 1.0, `ce_id`, `ce_source` `/catalog-service`, `ce_type` equal to the topic, `ce_subject` equal to the `orderId`, `ce_time`, `content-type` `application/json`), is not valid JSON, has an `orderId` that is not a UUID or no items THEN the order-service SHALL publish it to `order.stock-response.dlq` with the `dlq-*` headers and commit its offset. (STK-05)

**Independent Test**: An order with enough stock ends `CONFIRMED` with one `order.order.confirmed.v1`; one without ends `CANCELLED` with `OUT_OF_STOCK` and one `order.order.cancelled.v1`.

---

### P1: Follow the payment result ⭐ MVP

**User Story**: As the Omni Market, I want the order to follow the payment of the billing-service, so that a paid order is final and a refused payment gives the stock back.

**Acceptance Criteria**:

1. WHEN `billing.payment.confirmed.v1` arrives for a `CONFIRMED` order THEN the order-service SHALL set it `PAID`. (PAY-01)
2. WHEN `billing.payment.failed.v1` arrives for a `CONFIRMED` order THEN the order-service SHALL set it `CANCELLED` with the reason `PAYMENT_FAILED` and publish `order.order.cancelled.v1`. (PAY-02)
3. IF the result the order already has arrives again THEN the order-service SHALL change nothing and publish nothing. (PAY-03)
4. IF the result contradicts the order (a payment for an order that is not `CONFIRMED` and not already in that outcome), or the order is unknown, THEN the order-service SHALL change nothing, publish nothing, log a `warn` with the order id and the reason, record the `ce_id` and commit the offset without the dead letter topic. (PAY-04)
5. IF a payment result lacks a required CloudEvents header (as STK-05, with `ce_source` `/billing-service` and `ce_subject` equal to the `invoiceId`), is not valid JSON, has an `invoiceId` or `orderId` that is not a UUID, or is a failure without a non-blank `reason` THEN the order-service SHALL publish it to `order.billing-payment.dlq` with the `dlq-*` headers and commit its offset. (PAY-05)

**Independent Test**: A `CONFIRMED` order ends `PAID` after the confirmed payment, and `CANCELLED` with `PAYMENT_FAILED` and an `order.order.cancelled.v1` after the failed one.

---

### P1: Query the orders ⭐ MVP

**User Story**: As the BFF, I want to list and read orders, so that the stores and the customer success see them.

**Acceptance Criteria**:

1. WHEN `GET /orders/{id}` is called for an existing order THEN the order-service SHALL respond 200 with `id`, `marketplace`, `externalOrderId`, `status`, `total`, `items` (`sku`, `quantity`, `unitPrice`), `cancellationReason` (null unless cancelled), `createdAt` and `updatedAt`, money as JSON numbers. (API-01)
2. IF the order does not exist THEN the order-service SHALL respond 404 as `application/problem+json`, and IF the id is not a UUID THEN 400 naming it. (API-02)
3. WHEN `GET /orders` is called with the filters `marketplace` or `status` THEN the order-service SHALL return only the matching orders, newest first, as `{ orders, limit, offset }`, paginated by `limit` (default 20) and `offset`. (API-03)
4. IF `limit` is outside 1 to 100, `offset` is negative or a filter value is unknown THEN the order-service SHALL respond 400 as `application/problem+json` naming each invalid parameter. (API-04)

**Independent Test**: After the previous scenarios, `curl localhost:8084/orders?status=PAID` lists the paid order.

---

### P2: Sales report by marketplace

**User Story**: As customer success, I want the sales by marketplace in a period, so that I can compare the channels.

**Acceptance Criteria**:

1. WHEN `GET /reports/sales-by-marketplace?from=&to=` is called THEN the order-service SHALL return, for each of `AMAZON`, `MERCADO_LIVRE` and `SHOPEE`, the number of orders, the units and the total amount of the orders created from `from` to `to`, both inclusive, as UTC dates, with zeros for a marketplace without sales. (RPT-01)
2. WHEN the report is computed THEN the order-service SHALL count only orders `CONFIRMED` or `PAID`. (RPT-02)
3. IF `from` or `to` is missing, is not a `YYYY-MM-DD` date or `to` is before `from` THEN the order-service SHALL respond 400 as `application/problem+json` naming each invalid parameter. (RPT-03)
4. WHEN the orders of the demo script exist THEN the report SHALL match them (orders, units and amounts per marketplace). (RPT-04)

**Independent Test**: With one iPhone confirmed on Mercado Livre and one cancelled for lack of stock, the report shows one order, one unit and R$ 15.000,00 on Mercado Livre.

---

### P2: Infrastructure and documentation

**User Story**: As the team, I want the topics, the shutdown and the docs to be ready, so that `make up` runs the flow.

**Acceptance Criteria**:

1. WHEN `make up` runs THEN `kafka-init` SHALL create `order.marketplace-order.dlq`, `order.stock-response.dlq` and `order.billing-payment.dlq` (one partition, 14 days of retention). (INF-01)
2. WHEN the process receives SIGTERM THEN the order-service SHALL stop its consumers, close the server, flush the relay round and exit within 10 s. (INF-02)
3. WHEN the order-service handles a message THEN the work SHALL continue the trace of the message and appear in the telemetry like the other services. (INF-03)
4. WHEN the feature is done THEN `order-service/CLAUDE.md`, the event catalog states and the demo script SHALL describe the order life cycle and the new settings. (INF-04)

---

## Edge Cases

- IF `catalog.stock.reserved.v1` arrives for an order that is still being created THEN it cannot: `placed` is published after the order commits, so the answer always finds the order.
- IF a payment event arrives for an order that is `RECEIVED` THEN the order-service SHALL change nothing and log a `warn` without the dead letter (PAY-04; the billing-service charges only confirmed orders).
- WHEN the unit price carries float noise (a number with more than two decimals) THEN the message SHALL go to the dead letter instead of being rounded.
- WHEN an order has several lines of the same SKU THEN the order SHALL keep the lines as received; the catalog adds them up.
- WHILE the catalog is down the order-service SHALL keep receiving orders: they wait as `RECEIVED` (ADR-0004).

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| ORD-01 | P1: Receive the marketplace order | Tasks T2, T3, T4, T5, T7 | Implementing |
| ORD-02 | P1: Receive the marketplace order | Tasks T3, T4 | Implementing |
| ORD-03 | P1: Receive the marketplace order | Tasks T4 | Implementing |
| ORD-04 | P1: Receive the marketplace order | Tasks T2, T7 | Implementing |
| ORD-05 | P1: Receive the marketplace order | Tasks T7 | In Tasks |
| ORD-06 | P1: Receive the marketplace order | Task T7 | Implementing |
| STK-01 | P1: Follow the stock answer | Tasks T2, T3, T5, T7 | Implementing |
| STK-02 | P1: Follow the stock answer | Tasks T2, T3, T5, T7 | Implementing |
| STK-03 | P1: Follow the stock answer | Tasks T2, T3 | Implementing |
| STK-04 | P1: Follow the stock answer | Tasks T3, T7 | Implementing |
| STK-05 | P1: Follow the stock answer | Task T7 | Implementing |
| PAY-01 | P1: Follow the payment result | Tasks T2, T3, T7 | Implementing |
| PAY-02 | P1: Follow the payment result | Tasks T2, T3, T5, T7 | Implementing |
| PAY-03 | P1: Follow the payment result | Tasks T2, T3 | Implementing |
| PAY-04 | P1: Follow the payment result | Tasks T3, T7 | Implementing |
| PAY-05 | P1: Follow the payment result | Task T7 | Implementing |
| API-01 | P1: Query the orders | Tasks T3, T6 | Implementing |
| API-02 | P1: Query the orders | Tasks T6 | In Tasks |
| API-03 | P1: Query the orders | Tasks T4, T6 | Implementing |
| API-04 | P1: Query the orders | Tasks T6 | In Tasks |
| RPT-01 | P2: Sales report by marketplace | Tasks T3, T4, T6 | Implementing |
| RPT-02 | P2: Sales report by marketplace | Tasks T4 | Implementing |
| RPT-03 | P2: Sales report by marketplace | Tasks T6 | In Tasks |
| RPT-04 | P2: Sales report by marketplace | Tasks T9 | In Tasks |
| INF-01 | P2: Infrastructure and documentation | Tasks T8 | In Tasks |
| INF-02 | P2: Infrastructure and documentation | Tasks T8 | In Tasks |
| INF-03 | P2: Infrastructure and documentation | Tasks T7, T8 | In Tasks |
| INF-04 | P2: Infrastructure and documentation | Tasks T10 | In Tasks |

**ID format:** `[CATEGORY]-[NUMBER]`.

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 25 total, 25 mapped to tasks, 0 unmapped.

---

## Success Criteria

- [ ] In the demo, one iPhone ordered on Mercado Livre ends `PAID` with its invoice, seven iPhones end `CANCELLED` with `PAYMENT_FAILED`, an order without stock ends `CANCELLED` with `OUT_OF_STOCK`, and a repeated marketplace message leaves one order.
- [ ] `npm test` passes locally and in CI on each order-service pull request.
- [ ] One trace in Grafana Tempo goes from the consumed `marketplace.order.received.v1` to the published `order.order.placed.v1`.
