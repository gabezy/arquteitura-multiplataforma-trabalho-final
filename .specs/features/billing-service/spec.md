# billing-service Specification

Copy kept in sync at `docs/specs/billing-service/spec.md`; this file is the source.

Issues: #11 (scope, ADR and spec), #16 (bootstrap), #23 (invoice from the order), #32 (payment through the PSP). Decisions: ADR-0005 (what is charged), ADR-0006 (Go), ADR-0007 (PSP integration).

## Problem Statement

The C4 model only says the billing-service "does the billing". ADR-0004 already makes the order-service publish `order.order.confirmed.v1` once the catalog reserves the stock, says billing charges only from that event and says a refused payment cancels the order. Nothing charges a confirmed order yet, so the marketplace → order → stock → billing flow stops halfway, and the 28/10 demo and the 11/11 delivery need it whole.

## Goals

- [ ] Every confirmed order becomes exactly one invoice that records the Omni Market commission of its marketplace, even when Kafka redelivers the event.
- [ ] Every invoice is charged through the simulated PSP, and approved and refused payments change its status and publish `billing.payment.confirmed.v1` or `billing.payment.failed.v1`.
- [ ] The service starts with `make up`, shows up in Grafana (traces, logs, metrics) and its CI passes on every pull request.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Refund of a paid invoice whose order is cancelled later | Needs a refund call at the PSP and a new event; not asked by #23 or #32. The cancellation is logged as a warning. |
| Payout of the net amount to the store (split execution) | The invoice records the net amount; moving money to the store is a separate feature. |
| Tax documents (NF-e) | The Fiscal persona audits invoices; issuing tax documents is outside the course scope. |
| Monthly fee per store | Rejected in ADR-0005. |
| Currencies other than BRL | The three marketplaces sell in BRL. |
| Authentication on the billing REST API | Services trust the compose network; the BFF enforces roles (#9, #34). The PSP webhook is the exception (PAY-06). |
| BFF billing routes | #34 (Henrique). |
| order-service reaction to payment events | #20 and #29 (Rodrigo). |
| Cleanup of published outbox rows | Same open point as ADR-0002 in the catalog; follow-up. |
| Automated end-to-end test of the whole flow | #37 (Natan). Billing ships a manual demo script instead. |

---

## Assumptions & Open Questions

Every ambiguity is resolved or recorded here - nothing is left silently unclear.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Stack | Go 1.27, standard library HTTP, pgx, goose, franz-go, OpenTelemetry | The user asked for another language for a multiplatform course, "only if it makes sense"; ADR-0006 records why it does | y |
| What is charged | The confirmed order total, charged through the PSP, with the Omni Market commission per marketplace and the store's net amount recorded on the invoice | User choice on 2026-10-24; matches ADR-0004 (refused payment cancels the order) | y |
| PSP simulator | Billing ships the WireMock mappings of the PSP, overlapping #26 | User choice on 2026-10-24 | y |
| Trigger | `order.order.confirmed.v1` | ADR-0004 | y |
| Contract of `order.order.confirmed.v1` | As in the event catalog of #8 (`docs/eventos.md`): `orderId` (UUID), `marketplace`, optional `externalOrderId`, `items[]` with `sku`, `quantity`, `unitPrice`, `total` and `confirmedAt`; there is no currency field and every value is in BRL | The catalog proposes it and billing consumes it; the order-service owner (#20) still has to accept it | n |
| Marketplace values | `AMAZON`, `MERCADO_LIVRE`, `SHOPEE` | The three marketplaces of the C4 model, upper snake case like the other enums of the project | n |
| Money in events and in the API | JSON number with exactly two decimals (e.g. `15000.00`); stored as integer cents | The catalog already sends prices as JSON numbers; integer cents avoid float rounding | n |
| Commission rates | `AMAZON` 12%, `MERCADO_LIVRE` 11%, `SHOPEE` 14%, overridable by environment variables | Simulation values close to real platform fees; the rate is chosen per marketplace (Strategy) | n |
| Commission rounding | Half-up to the cent | Usual commercial rounding (Fowler's Money pattern) | n |
| PSP refusal rule | Charges of R$ 100.000,00 or more are refused with `INSUFFICIENT_FUNDS` | Demo products cost R$ 9.000 and R$ 15.000: one unit is approved, seven iPhones are refused | n |
| When the charge is requested | A worker polls `ISSUED` invoices every 2 s | Keeps the Kafka consumer independent of the PSP being up | n |
| PSP resilience parameters | 3 s timeout per attempt; 3 attempts with 200 ms and 400 ms backoff; the circuit opens after 5 consecutive failed attempts and stays open for 30 s | Small enough to show live in the demo | n |
| Retry of an invoice after a failed request | Next attempt after min(2^attempts, 60) seconds | Avoids a hot loop on the same invoice while the PSP is down | n |
| Webhook authentication | Shared token in the `X-PSP-Token` header (`PSP_WEBHOOK_TOKEN`), compared in constant time | The simulator cannot sign payloads; a token keeps unauthenticated callers out | n |
| Reconciliation | Every 30 s, for invoices `PAYMENT_PENDING` for more than 60 s | Covers a lost webhook without load on the PSP | n |
| Cancellation that arrives before the confirmation | The cancellation is recorded; a later confirmation creates no invoice | Kafka gives no order across topics; the catalog handles the same case the same way | n |
| Cancellation of a paid invoice | Status kept, warning logged, no refund | Refund is out of scope | n |
| Input bounds | 1 to 100 items; quantity 1 to 10 000; unit price 0.01 to 1 000 000.00 | Rejects absurd orders and keeps cents far from int64 overflow | n |
| Kafka key of billing events | `invoiceId` | Project convention: the key is the aggregate id (#8) | n |
| Pagination of the query API | `limit` 1 to 100 (default 20), `offset` ≥ 0, newest first | Enough for the BFF lists of #34 | n |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: Billing scope and contracts recorded ⭐ MVP

**User Story**: As the team, I want the billing scope, its events and the PSP contract written down, so that the order-service, the BFF and the PSP simulator build against the same contract.

**Why P1**: #11 is due on 24/10 (M1) and every other billing story depends on it.

**Acceptance Criteria**:

1. The billing scope SHALL be recorded in ADR-0005 with at least three alternatives and their trade-offs. (DOC-01)
2. The billing events and the order events billing consumes SHALL be listed in the event catalog `docs/eventos.md` (#8) with producer, consumers, key, CloudEvent type, a JSON example and the DLQ. (DOC-02)
3. The PSP contract SHALL be documented with request and response examples for charge creation, webhook and status query. (DOC-03)

**Independent Test**: Review ADR-0005 in the pull request of #11 and the billing sections of `docs/eventos.md` in the pull request of #8.

---

### P1: Service bootstrap ⭐ MVP

**User Story**: As the billing owner, I want a Go service that starts with `make up`, reports its health and telemetry and passes CI, so that the billing features run on a production-like base.

**Why P1**: Every feature story runs on it; #16 is due on 24/10 (M1).

**Acceptance Criteria**:

1. WHEN `GET /health` is called and the database answers THEN the billing-service SHALL respond 200 with `{"status":"UP"}`. (BOOT-01)
2. IF the database does not answer within 2 s THEN the billing-service SHALL respond 503 with `{"status":"DOWN"}` to `GET /health`. (BOOT-02)
3. WHEN the service starts THEN the billing-service SHALL apply the pending database migrations before it accepts HTTP requests. (BOOT-03)
4. IF a configuration variable is invalid THEN the billing-service SHALL exit with a non-zero status and an error that names the variable without printing its value. (BOOT-04)
5. The billing-service SHALL export traces, metrics and logs over OTLP/HTTP to `OTEL_COLLECTOR_URL` with `service.name` `billing-service`. (BOOT-05)
6. WHEN the process receives SIGTERM THEN the billing-service SHALL stop accepting requests, finish the work in progress and exit within 10 s. (BOOT-06)
7. WHEN `make up` runs THEN the `billing-db` and `billing-service` containers SHALL become healthy, with the service on port 8086 and the database on port 5435. (BOOT-07)
8. WHEN a push changes `billing-service/**` THEN the CI SHALL run lint, the tests and the Docker build of billing only. (BOOT-08)
9. The core packages SHALL import only the Go standard library and other core packages. (BOOT-09)
10. WHEN an aggregate is saved with domain events THEN the billing-service SHALL write them to the outbox in the same transaction, and the relay SHALL publish each one to the topic named after its type, keyed by the aggregate id, with CloudEvents binary headers. (BOOT-10)

**Independent Test**: `make up`, then `curl localhost:8086/health` answers `UP`, the service shows up in Grafana Tempo, and `docker stop billing-db` turns the health check into 503.

---

### P1: Invoice from the confirmed order ⭐ MVP

**User Story**: As the Omni Market, audited by the Fiscal persona, I want every confirmed order to become exactly one invoice with the commission of its marketplace, so that each sale is charged once and the platform revenue is known.

**Why P1**: It is the billing step of the 28/10 demo (#23, M2).

**Acceptance Criteria**:

1. WHEN a valid `order.order.confirmed.v1` arrives THEN the billing-service SHALL create one invoice with status `ISSUED` whose total is the sum of quantity × unit price of its items. (INV-01)
2. WHEN an invoice is created THEN the billing-service SHALL set the commission to the total × the rate of its marketplace rounded half-up to the cent, and the net amount to the total minus the commission. (INV-02)
3. WHEN an invoice is created THEN the billing-service SHALL publish `billing.invoice.issued.v1` keyed by `invoiceId` through the outbox. (INV-03)
4. IF an event whose `ce_id` was already processed arrives THEN the billing-service SHALL change nothing and publish nothing. (INV-04)
5. IF a confirmation arrives for an order that already has an invoice THEN the billing-service SHALL keep the single existing invoice and publish nothing. (INV-05)
6. IF a message lacks a required CloudEvents header, is not valid JSON, has an `orderId` that is not a UUID, an unknown marketplace, a `total` that differs from the sum of quantity × unit price or items out of bounds THEN the billing-service SHALL publish it to `billing.order-events.dlq` with `dlq-*` headers and commit its offset. (INV-06)
7. IF processing fails for a transient reason THEN the billing-service SHALL retry the same message with a backoff that starts at 1 s and doubles up to 30 s, without committing its offset. (INV-07)
8. WHEN `order.order.cancelled.v1` arrives for an invoice in `ISSUED` or `PAYMENT_PENDING` THEN the billing-service SHALL set the invoice to `CANCELLED`. (INV-08)
9. IF `order.order.cancelled.v1` arrives for an order without an invoice THEN the billing-service SHALL record the cancellation of that order. (INV-09)
10. WHEN a confirmation arrives for an order whose cancellation is recorded THEN the billing-service SHALL create no invoice. (INV-10)
11. IF `order.order.cancelled.v1` arrives for an invoice in `PAID`, `PAYMENT_FAILED` or `CANCELLED` THEN the billing-service SHALL keep its status. (INV-11)

**Independent Test**: Publish the same confirmation twice with the demo script: one invoice and one `billing.invoice.issued.v1`. Publish a malformed one: it lands in `billing.order-events.dlq`.

---

### P1: Query invoices

**User Story**: As the BFF, acting for the store, the Fiscal and the administrator, I want to read an invoice by id and list invoices by order, status and marketplace, so that the billing routes of #34 can show them.

**Why P1**: #23 asks for it and the BFF routes (#34) depend on it.

**Acceptance Criteria**:

1. WHEN `GET /invoices/{id}` names an existing invoice THEN the billing-service SHALL respond 200 with the invoice, its items and its amounts. (API-01)
2. IF `GET /invoices/{id}` names no invoice THEN the billing-service SHALL respond 404 as `application/problem+json`. (API-02)
3. WHEN `GET /invoices` is called with `orderId`, `status` or `marketplace` filters THEN the billing-service SHALL return only the matching invoices, newest first, paginated by `limit` (default 20) and `offset`. (API-03)
4. IF `limit` is outside 1 to 100, `offset` is negative or a filter value is unknown THEN the billing-service SHALL respond 400 as `application/problem+json`. (API-04)

**Independent Test**: After the previous demo, `curl "localhost:8086/invoices?orderId=<id>"` lists the invoice.

---

### P2: Charge the invoice at the PSP

**User Story**: As the Omni Market, I want every issued invoice charged at the PSP and its outcome published, so that the order-service confirms or cancels the order.

**Why P2**: It closes the flow for the 11/11 delivery (#32, M3); the 28/10 demo can stop at the issued invoice.

**Acceptance Criteria**:

1. WHILE an invoice is `ISSUED` and its next attempt is due, the billing-service SHALL request a charge at the PSP with `Idempotency-Key` equal to the invoice id and the total in cents. (PAY-01)
2. WHEN the PSP accepts the charge with 201 THEN the billing-service SHALL store the charge id and set the invoice to `PAYMENT_PENDING`. (PAY-02)
3. WHEN a webhook with a valid token reports `PAID` THEN the billing-service SHALL set the invoice to `PAID` and publish `billing.payment.confirmed.v1`. (PAY-03)
4. WHEN a webhook with a valid token reports `FAILED` THEN the billing-service SHALL set the invoice to `PAYMENT_FAILED` with the PSP reason and publish `billing.payment.failed.v1`. (PAY-04)
5. IF the PSP answers the charge request with 422 THEN the billing-service SHALL set the invoice to `PAYMENT_FAILED` and publish `billing.payment.failed.v1`. (PAY-05)
6. IF the `X-PSP-Token` header of a webhook is missing or wrong THEN the billing-service SHALL respond 401 and change nothing. (PAY-06)
7. IF a webhook repeats the outcome the invoice already has THEN the billing-service SHALL respond 204 and publish nothing. (PAY-07)
8. IF a webhook contradicts the final status of the invoice or its charge id THEN the billing-service SHALL respond 409 and change nothing. (PAY-08)
9. IF a PSP attempt times out after 3 s, fails to connect or returns 5xx THEN the billing-service SHALL retry it, up to 3 attempts in total, with exponential backoff. (PAY-09)
10. IF all attempts of a charge request fail THEN the billing-service SHALL keep the invoice `ISSUED` and schedule its next attempt min(2^attempts, 60) seconds later. (PAY-10)
11. IF 5 consecutive PSP attempts fail THEN the billing-service SHALL open the circuit for 30 s and make no PSP call while it is open. (PAY-11)
12. WHEN the simulated PSP receives a charge of R$ 100.000,00 or more THEN the WireMock mappings SHALL answer 201 and call the webhook with `FAILED` and `INSUFFICIENT_FUNDS`, and below that amount they SHALL call it with `PAID`. (PAY-12)

**Independent Test**: With `make up`, an order of one iPhone ends `PAID` and an order of seven iPhones ends `PAYMENT_FAILED`, each with its event in Kafka UI. With the PSP outage stub on, the log shows the circuit opening and new invoices stay `ISSUED` until the stub is removed.

---

### P3: Reconcile pending payments

**User Story**: As the Omni Market, I want pending charges reconciled with the PSP, so that a lost webhook does not leave an invoice pending forever.

**Why P3**: The webhook covers the normal flow; reconciliation covers a failure the demo rarely hits.

**Acceptance Criteria**:

1. WHILE an invoice has been `PAYMENT_PENDING` for more than 60 s, the billing-service SHALL query the status of its charge at the PSP every 30 s. (REC-01)
2. WHEN reconciliation finds a final status at the PSP THEN the billing-service SHALL apply it with the same transitions and events as the webhook. (REC-02)

**Independent Test**: Point `PSP_CALLBACK_URL` to an address that does not answer, order one iPhone, and the invoice still ends `PAID` within 2 minutes.

---

## Edge Cases

- IF two confirmations of the same order are processed at the same time THEN the unique `order_id` SHALL keep a single invoice, and the losing transaction SHALL be retried and find it.
- WHEN a webhook arrives while the payment worker still holds the invoice THEN the webhook SHALL wait for the row lock and apply on top of `PAYMENT_PENDING`.
- IF a webhook arrives for an invoice that is still `ISSUED` THEN the billing-service SHALL store its charge id and apply the outcome.
- IF a webhook references an unknown invoice THEN the billing-service SHALL respond 404.
- IF the webhook body is not valid JSON or misses a field THEN the billing-service SHALL respond 400.
- WHEN the commission falls exactly on half a cent THEN the billing-service SHALL round it up (total R$ 0,25 at 14% gives R$ 0,04).
- WHILE the circuit is open the billing-service SHALL keep issuing invoices from Kafka.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| DOC-01 | P1: Billing scope and contracts recorded | Tasks T1 | Implementing |
| DOC-02 | P1: Billing scope and contracts recorded | Tasks T2 | Implementing |
| DOC-03 | P1: Billing scope and contracts recorded | Tasks T2 | Implementing |
| BOOT-01 | P1: Service bootstrap | Tasks T6 | Implementing |
| BOOT-02 | P1: Service bootstrap | Tasks T6 | Implementing |
| BOOT-03 | P1: Service bootstrap | Tasks T5 | Implementing |
| BOOT-04 | P1: Service bootstrap | Tasks T4 | Implementing |
| BOOT-05 | P1: Service bootstrap | Tasks T4 | Implementing |
| BOOT-06 | P1: Service bootstrap | Tasks T8 | Implementing |
| BOOT-07 | P1: Service bootstrap | Tasks T9 | Implementing |
| BOOT-08 | P1: Service bootstrap | Tasks T10 | Implementing |
| BOOT-09 | P1: Service bootstrap | Tasks T4 | Implementing |
| BOOT-10 | P1: Service bootstrap | Tasks T7 | Implementing |
| INV-01 | P1: Invoice from the confirmed order | Tasks T12, T13 | Implementing |
| INV-02 | P1: Invoice from the confirmed order | Tasks T12 | Implementing |
| INV-03 | P1: Invoice from the confirmed order | Tasks T14, T15 | Implementing |
| INV-04 | P1: Invoice from the confirmed order | Tasks T15 | Implementing |
| INV-05 | P1: Invoice from the confirmed order | Tasks T13, T14 | Implementing |
| INV-06 | P1: Invoice from the confirmed order | Tasks T15 | Implementing |
| INV-07 | P1: Invoice from the confirmed order | Tasks T15 | Implementing |
| INV-08 | P1: Invoice from the confirmed order | Tasks T12, T13 | Implementing |
| INV-09 | P1: Invoice from the confirmed order | Tasks T13, T14 | Implementing |
| INV-10 | P1: Invoice from the confirmed order | Tasks T13 | Implementing |
| INV-11 | P1: Invoice from the confirmed order | Tasks T12 | Implementing |
| API-01 | P1: Query invoices | Tasks T16 | Implementing |
| API-02 | P1: Query invoices | Tasks T16 | Implementing |
| API-03 | P1: Query invoices | Tasks T14, T16 | Implementing |
| API-04 | P1: Query invoices | Tasks T16 | Implementing |
| PAY-01 | P2: Charge the invoice at the PSP | Tasks T19, T20, T23 | Implementing |
| PAY-02 | P2: Charge the invoice at the PSP | Tasks T19 | Implementing |
| PAY-03 | P2: Charge the invoice at the PSP | Tasks T19, T22 | Implementing |
| PAY-04 | P2: Charge the invoice at the PSP | Tasks T19, T22 | Implementing |
| PAY-05 | P2: Charge the invoice at the PSP | Tasks T19, T21 | Implementing |
| PAY-06 | P2: Charge the invoice at the PSP | Tasks T22 | In Tasks |
| PAY-07 | P2: Charge the invoice at the PSP | Tasks T19, T22 | Implementing |
| PAY-08 | P2: Charge the invoice at the PSP | Tasks T19, T22 | Implementing |
| PAY-09 | P2: Charge the invoice at the PSP | Tasks T21 | In Tasks |
| PAY-10 | P2: Charge the invoice at the PSP | Tasks T19 | Implementing |
| PAY-11 | P2: Charge the invoice at the PSP | Tasks T21 | In Tasks |
| PAY-12 | P2: Charge the invoice at the PSP | Tasks T21 | In Tasks |
| REC-01 | P3: Reconcile pending payments | Tasks T20, T23 | In Tasks |
| REC-02 | P3: Reconcile pending payments | Tasks T19, T23 | Implementing |

**ID format:** `[CATEGORY]-[NUMBER]`.

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 42 total, 42 mapped to tasks, 0 unmapped.

---

## Success Criteria

- [ ] In the demo, one iPhone ordered on Mercado Livre ends in a `PAID` invoice with an 11% commission, seven iPhones end `PAYMENT_FAILED`, and a repeated confirmation still leaves one invoice.
- [ ] `go test ./...` passes locally and in CI on each billing pull request.
- [ ] One trace in Grafana Tempo goes from the consumed `order.order.confirmed.v1` to the published `billing.invoice.issued.v1`.
