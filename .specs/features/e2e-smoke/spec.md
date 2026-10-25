# E2E smoke test (`make e2e`) Specification

Issue: #37 · Owner: Natan de Almeida Figueiredo · Date: 2026-10-24 (v1), 2026-10-25 (v2) · Scope: Medium

## Problem Statement

The demo script (#27) proves the flow by hand, and nothing re-checks it when a service changes. Issue #37 asks for an automated test that brings the environment up, imports a spreadsheet through the BFF and verifies each step of the flow by API, from the approved product to the billing, so that `make e2e` passes from scratch on a clean machine with Docker before the final delivery (11/11).

v1 automated authentication, import, compliance and stock, published the order events by hand and listed the steps of the services still under construction as pending. Those services (order, marketplace-gateway, billing) are now on `dev`. v2 replaces the pending steps and the hand-published events with the real flow: a listing in the three marketplaces, an order that a marketplace simulator sends, its confirmation, its invoice and payment, and a refused payment that gives the stock back.

## Goals

- [ ] `make e2e` brings the stack up and verifies authentication, import, compliance, listing, order, confirmation, billing and the refused payment, ending with exit code 0 when they work.
- [ ] A broken step makes the run end with exit code 1 and names the step that failed.
- [ ] The test can run again on the same environment, without `make clean`, and pass again.
- [ ] The test only uses the public interfaces of the flow: the BFF, the catalog query, Keycloak and the WireMock simulators. It publishes no Kafka message by hand.

## Out of Scope

| Feature | Reason |
| --- | --- |
| GitHub Actions `workflow_dispatch` job | Optional in #37; the stack needs about 15 containers, and the team now deploys with kind and act (#71) |
| Running the test against the kind deployment | #37 asks for `make e2e` on the local environment; the compose path is still supported |
| Orders from Amazon and Shopee | The three adapters share one flow after the canonical order; one marketplace keeps the test short |
| Marketplace-side cancellation, sales report, stock sync to the marketplaces | Not steps of the main flow in #37 (import → compliance → listing → order → stock → billing) |
| Fixing the BFF 500 on a repeated import | Belongs to the bff-gateway front (found in the #27 rehearsal) |
| Tearing the environment down or wiping volumes | Destructive to the developer's local data; `make compose-clean` stays a manual step |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Prerequisites | `bash`, `curl` and Docker with Compose; `make` only for the `make e2e` shortcut; `sh` and `openssl` when `scripts/generate-env.sh` creates the `.env` | #37: "numa máquina limpa com Docker"; the Windows dev machine has no `jq`, `make` or reliable `python` | y |
| Spreadsheet | Generated on every run with SKUs suffixed by a run id, by a throwaway `python:3.13-alpine` container that writes the xlsx to stdout. Four products: one approved and cheap (stock 2), one approved above R$ 50.000 (stock 2), one rejected by a prohibited term, one rejected above the price ceiling | The catalog rejects repeated SKUs; the second approved product lets an order of 2 units reach the PSP refusal threshold (R$ 100.000) while each unit stays under the compliance ceiling (R$ 100.000) | y |
| Bringing the stack up | The script runs `docker compose up -d --build` and waits for the seven apps to be healthy, unless `E2E_SKIP_UP=1` | #37 says the script "sobe a infra"; `up -d` is a no-op on a running stack | y |
| JSON parsing | `grep`/`sed` on the response bodies | No `jq` on the target machines | y |
| Where the orders come from | The script registers a Mercado Livre order in the WireMock simulator (`POST /__admin/mappings`, its own stub with priority 1 and a run-unique id) and lets the marketplace-gateway poll it | It is how a marketplace sends orders in this system (ADR-0010); no Kafka message is published by hand, so every event carries the producers' CloudEvents headers | y |
| Simulator stubs left behind | The script removes its stubs when it ends, on success or failure | While present, a stub hides the default "no orders" answer of the Mercado Livre simulator | y |
| Refused payment | The WireMock PSP refuses a charge of R$ 100.000 or more (`docker/wiremock/mappings/psp.json`); the test orders 2 units of the expensive product | It is the only refusal the PSP simulator offers; the refusal is what makes the order cancel and the catalog give the stock back | y |
| Choosing the order quantity (E2E-36) | `E2E_ORDER_QUANTITY` (default 1) sets the units of the paid order | A test hook: an order above the stock, or of 2 units, is the only deterministic way to make the confirmation checks fail | y |
| Timeouts | Stack health 300 s (`E2E_TIMEOUT`), each asynchronous check 60 s; the token request is tried up to 5 times, 2 s apart, while Keycloak gives no answer (HTTP 000), and each retry prints `autenticacao: tentativa N de 5 sem resposta do Keycloak` | The cold Keycloak start took about 2 min; the whole order flow took about 10 s by hand (polling every 5 s, PSP webhook after 2 s); one harness run saw a single token request time out with Keycloak healthy | y |
| Ports | BFF on `BFF_PORT` (default 8080); catalog 8082, Keycloak 8085, WireMock 8089, as in the compose | The compose lets only `BFF_PORT` and `GRAFANA_PORT` change | y |
| Script location and name | `scripts/e2e-smoke.sh` at the repository root, target `e2e` in the root `Makefile` | Suggested by #37 | y |
| What "never deletes" covers (E2E-17) | No `down`, `rm` or `volume rm`; every volume survives. Containers that `docker compose up --build` recreates because an image changed do not count | Found during Execute (v1): compose recreated containers with their volumes intact | y |
| Client secret (E2E-25) | `BFF_CLIENT_SECRET` from the environment, else from the `.env` that `scripts/generate-env.sh` creates; `make e2e` depends on `make env` | Vault (ADR-0003, #48): the realm reads the secret from `.env` | y |
| How E2E-02 is verified | Both calls, `scripts/generate-env.sh` and `docker compose up -d --build`, are checked through the "Subindo o ambiente" banner and by reading the code | On a running stack with a complete `.env` both calls change nothing; covering it would mean editing the developer's `.env`. Decided by the owner (v1, mutant MB) | y |
| Later checks of one step | Inside the billing and refused-payment steps, the first check has a dedicated fault; the checks after it (the order `PAID` after the invoice `PAID`; the order `CANCELLED` and the stock back after the invoice `PAYMENT_FAILED`) follow from it in the real flow and are verified by reading the code | No fault can pay an invoice without paying its order, or refuse it without cancelling the order, without editing a service | y |
| Output language | Report lines in Portuguese (`[OK]`, `[FALHA]`), ASCII only | The team's docs are in Portuguese; ASCII avoids broken characters in the Windows console | y |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: Run the flow end to end with one command ⭐ MVP

**User Story**: As a team member, I want `make e2e` to verify the whole flow so that I know the demo still works after any change.

**Why P1**: The acceptance criterion of #37.

**Acceptance Criteria**:

1. WHEN `make e2e` runs THEN the Makefile SHALL run `scripts/e2e-smoke.sh`.  <!-- event-driven -->
2. WHEN the script starts without `E2E_SKIP_UP=1` THEN the script SHALL run `scripts/generate-env.sh` and then `docker compose up -d --build` from the repository root.  <!-- event-driven -->
3. WHERE `E2E_SKIP_UP=1` is set the script SHALL not run `docker compose up`.  <!-- optional-feature -->
4. WHEN the stack is starting THEN the script SHALL wait until `keycloak`, `bff-gateway`, `catalog-service`, `compliance-service`, `order-service`, `billing-service` and `marketplace-gateway` report `healthy`, for at most `E2E_TIMEOUT` seconds (default 300).  <!-- event-driven -->
5. WHEN the stack is healthy THEN the script SHALL get an access token for the `admin` user from Keycloak.  <!-- event-driven -->
6. WHEN the script imports the spreadsheet through `POST /catalog/import/xlsx` without a token THEN the BFF SHALL answer `401`, and the script SHALL check it.  <!-- event-driven -->
7. WHEN the script imports the generated spreadsheet with the admin token THEN the script SHALL check that the BFF answers `200` with `importedProducts` equal to the number of rows (4).  <!-- event-driven -->
8. WHEN the import succeeded THEN the script SHALL check, within 60 s, that `GET /products/sku/<sku>` shows `analysisStatus` `APPROVED` for the two approved products and `REJECTED` for the product with a prohibited term and for the product above the price ceiling.  <!-- event-driven -->
9. WHEN the cheap product is approved THEN the script SHALL check, within 60 s, that `GET /listings?sku=<sku>` through the BFF shows 3 listings with status `PUBLISHED`.  <!-- event-driven -->
10. WHEN the listings are published THEN the script SHALL register a Mercado Livre order of `E2E_ORDER_QUANTITY` units (default 1) of the cheap product in the simulator, with a run-unique order id, and SHALL check, within 60 s, that `GET /orders?marketplace=MERCADO_LIVRE` through the BFF shows an order with that `externalOrderId`.  <!-- event-driven -->
11. WHEN the order is received THEN the script SHALL check, within 60 s, that the order status is `CONFIRMED` or `PAID`.  <!-- event-driven -->
12. WHEN the order is confirmed THEN the script SHALL check, within 60 s, that the stock of the cheap product is 1.  <!-- event-driven -->
13. WHEN the order is confirmed THEN the script SHALL check, within 60 s, that `GET /invoices?orderId=<id>` through the BFF shows an invoice with status `PAID`.  <!-- event-driven -->
14. WHEN the invoice is paid THEN the script SHALL check, within 60 s, that the order status is `PAID`.  <!-- event-driven -->
15. WHEN the paid order is done THEN the script SHALL register a Mercado Livre order of 2 units of the expensive product and SHALL check, within 60 s, that its invoice has status `PAYMENT_FAILED`.  <!-- event-driven -->
16. WHEN that invoice failed THEN the script SHALL check, within 60 s, that the order status is `CANCELLED` with `cancellationReason` `PAYMENT_FAILED`.  <!-- event-driven -->
17. WHEN that order is cancelled THEN the script SHALL check, within 60 s, that the stock of the expensive product is back to 2.  <!-- event-driven -->
18. WHEN every step passes THEN the script SHALL print one `[OK] <step>` line per step, in the order ambiente, autenticacao, importacao, compliance, anuncio, pedido, confirmacao, cobranca, devolucao, and exit with code 0.  <!-- event-driven -->
19. The script SHALL ask Keycloak for the token with the client secret in `BFF_CLIENT_SECRET`, read from `.env` when the variable is not set.  <!-- ubiquitous -->
20. WHEN the run ends THEN the script SHALL remove the simulator stubs it registered.  <!-- event-driven -->

**Independent Test**: on a running stack, `E2E_SKIP_UP=1 bash scripts/e2e-smoke.sh` prints the nine `[OK]` lines and exits 0.

---

### P1: Fail loudly on a broken step ⭐ MVP

**User Story**: As a team member, I want a broken step to fail the run and say which step broke so that I know where to look.

**Why P1**: A test that cannot fail is useless.

**Acceptance Criteria**:

1. IF a check fails THEN the script SHALL print `[FALHA] <step>: <reason>` and exit with code 1 without running the next steps.  <!-- unwanted -->
2. IF the stack is not healthy within `E2E_TIMEOUT` seconds THEN the script SHALL fail the stack step and print the services that are not healthy.  <!-- unwanted -->
3. IF an asynchronous check does not reach its expected value within 60 s THEN the script SHALL fail that step and print the last value it observed.  <!-- unwanted -->
4. WHEN the run ends THEN the script SHALL print a summary line with the number of passed and failed steps.  <!-- event-driven -->

**Independent Test**: take `order-service` off the compose network and run the script with `E2E_SKIP_UP=1`: it prints `[FALHA] pedido` and exits 1.

---

### P1: Repeatable runs ⭐ MVP

**User Story**: As a team member, I want to run the test again on the same environment so that I do not have to wipe my local data between runs.

**Why P1**: #37 must pass "do zero", and the developers run it on their own environment many times.

**Acceptance Criteria**:

1. The script SHALL suffix every SKU of the generated spreadsheet and every simulated order id with a run id that is different on every run.  <!-- ubiquitous -->
2. WHEN the script runs twice on the same environment THEN both runs SHALL exit with code 0.  <!-- event-driven -->
3. The script SHALL not run `docker compose down`, `docker rm` or `docker volume rm`, and every volume SHALL still exist after a run.  <!-- ubiquitous -->

**Independent Test**: run the script twice in a row on the same stack; both exit 0.

---

### P2: Documentation

**User Story**: As a team member, I want the test documented where the others look so that I know how to run it.

**Acceptance Criteria**:

1. The root `README.md` SHALL describe `make e2e`, its prerequisites and the `E2E_SKIP_UP`, `E2E_TIMEOUT`, `BFF_PORT`, `BFF_CLIENT_SECRET` and `E2E_ORDER_QUANTITY` variables.  <!-- ubiquitous -->
2. The root `Makefile` SHALL list `e2e` in `make help`.  <!-- ubiquitous -->

**Independent Test**: read the README section and run `make` to see `e2e` listed.

---

## Edge Cases

- IF Keycloak does not return an access token THEN the script SHALL fail the authentication step and print the HTTP status it got.
- IF the BFF answers anything other than `200` on the import THEN the script SHALL fail the import step and print the status and body.
- WHEN the script runs on Git Bash (Windows) THEN the `docker` calls SHALL work without the caller setting `MSYS_NO_PATHCONV`.
- IF the generated spreadsheet cannot be created THEN the script SHALL fail the import step before calling the BFF.
- IF the order quantity is above the stock THEN the catalog SHALL refuse the reservation, the order SHALL end `CANCELLED`, and the script SHALL fail the confirmation step with the last status it saw.

### Implicit-requirement sweep

| Dimension | Coverage |
| --- | --- |
| Idempotency / retry / duplicate handling | Run-unique SKUs and order ids (Repeatable runs AC-1, AC-2) |
| Failure / partial-failure states | Stop at the first failed step with its reason (Fail loudly AC-1..3); refused payment gives the stock back (Run AC-15..17) |
| External-dependency failure | Stack health timeout and per-step timeouts (Fail loudly AC-2, AC-3) |
| Auth boundaries | 401 without token and admin token (Run AC-5, AC-6, AC-19) |
| Remaining dimensions | N/A for this scope: the script is a test client; its only state is the simulator stubs, removed at the end (Run AC-20) |

---

## Requirement Traceability

v2 keeps the v1 IDs that still apply, retires the ones of the hand-published events and of the pending steps, and adds new IDs for the real flow.

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| E2E-01 | P1 Run: `make e2e` runs the script | Execute | Implementing |
| E2E-02 | P1 Run: `generate-env.sh` and `docker compose up -d --build` | Execute | Implementing |
| E2E-03 | P1 Run: `E2E_SKIP_UP=1` skips the up | Execute | Implementing |
| E2E-04 | P1 Run: waits for the seven apps healthy | Execute | Implementing |
| E2E-05 | P1 Run: admin token | Execute | Implementing |
| E2E-06 | P1 Run: 401 without token | Execute | Implementing |
| E2E-07 | P1 Run: import with `importedProducts` 4 | Execute | Implementing |
| E2E-08 | P1 Run: compliance statuses | Execute | Implementing |
| E2E-09 | v1: reservation by a hand-published `order.order.placed.v1` | - | Retired (v2, replaced by E2E-27..29) |
| E2E-10 | v1: stock back by a hand-published `order.order.cancelled.v1` | - | Retired (v2, replaced by E2E-32..34) |
| E2E-11 | P1 Run: nine `[OK]` lines in order and exit 0 | Execute | Implementing |
| E2E-12 | P1 Fail: `[FALHA]` and exit 1, stop | Execute | Implementing |
| E2E-13 | P1 Fail: stack timeout lists unhealthy services | Execute | Implementing |
| E2E-14 | P1 Fail: async timeout prints last value | Execute | Implementing |
| E2E-15 | P1 Repeat: run-unique SKUs and order ids | Execute | Implementing |
| E2E-16 | P1 Repeat: two runs pass | Execute | Implementing |
| E2E-17 | P1 Repeat: no deletion | Execute | Implementing |
| E2E-18 | v1: four `[PENDENTE]` lines | - | Retired (v2, no pending steps) |
| E2E-19 | v1: exit 0 with pending steps | - | Retired (v2) |
| E2E-20 | v1: `E2E_STRICT=1` | - | Retired (v2) |
| E2E-21 | P1 Fail: summary line of passed and failed steps | Execute | Implementing |
| E2E-22 | P2 Docs: README section | Execute | Implementing |
| E2E-23 | P2 Docs: `e2e` in `make help` | Execute | Implementing |
| E2E-24 | v1: `E2E_ORDER_ID` | - | Retired (v2, replaced by E2E-36) |
| E2E-25 | P1 Run: client secret from `BFF_CLIENT_SECRET` or `.env` | Execute | Implementing |
| E2E-26 | P1 Run: listing `PUBLISHED` in 3 marketplaces | Execute | Implementing |
| E2E-27 | P1 Run: simulated Mercado Livre order received | Execute | Implementing |
| E2E-28 | P1 Run: order `CONFIRMED` or `PAID` | Execute | Implementing |
| E2E-29 | P1 Run: stock of the cheap product is 1 | Execute | Implementing |
| E2E-30 | P1 Run: invoice `PAID` | Execute | Implementing |
| E2E-31 | P1 Run: order `PAID` | Execute | Implementing |
| E2E-32 | P1 Run: refused invoice `PAYMENT_FAILED` | Execute | Implementing |
| E2E-33 | P1 Run: order `CANCELLED` with `PAYMENT_FAILED` | Execute | Implementing |
| E2E-34 | P1 Run: stock of the expensive product back to 2 | Execute | Implementing |
| E2E-35 | P1 Run: simulator stubs removed at the end | Execute | Implementing |
| E2E-36 | P1 Run: `E2E_ORDER_QUANTITY` sets the units of the paid order | Execute | Implementing |

**Coverage:** 36 IDs; 6 retired, 30 active, 30 mapped to Execute, 0 unmapped

---

## Success Criteria

- [ ] On a clean machine with Docker, `make e2e` passes from scratch.
- [ ] Two consecutive runs on the same environment both pass.
- [ ] Breaking any service the flow uses makes the run fail at the matching step.
