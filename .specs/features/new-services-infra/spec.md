# New services infra Specification

Issue: #14 · Owner: José Ricardo Ciola Bricio (@zeciola) · Milestone: M1 — Fundação e contratos · Date: 2026-10-24
Copy kept in sync at `docs/specs/plataforma/infra-servicos-novos/spec.md`; this file is the source.

References: ADR-0001 (monorepo and CI per service), C4 container diagram (`docs/c4/Omni Market - C4 Model Contexto.drawio`, page `C4 - Container`, exported to `docs/c4/Omni Market - C4 Model Contexto-C4 - Container.drawio.png`), event catalog (`docs/eventos.md`).

## Problem Statement

The order-service, billing-service and marketplace-gateway need their own database, a reserved HTTP port, their Kafka topics and an isolated CI pipeline before their domain work can run in parallel. Most of this already landed on `dev` with the service bootstraps (#15, #16 and the marketplace-gateway PRs), so #14 has no proof that its acceptance criteria hold. Two documents are also stale. `docs/eventos.md` still lists as pending topics that `create-topics.sh` already creates. The C4 container diagram still shows the stack of billing-service and marketplace-gateway as "A definir" and the content of `billing-db` and `marketplace-db` as "a definir, #14". This feature verifies the infrastructure against the issue, fixes the gaps it finds and leaves evidence that closes #14.

### C4 container diagram check (2026-10-24)

| Element | C4 today | Infra on `dev` | Result |
| --- | --- | --- | --- |
| `order-service`, `billing-service`, `marketplace-gateway` | Present, each reading and writing its own database | Compose services on 8084, 8086, 8087 | Match |
| `order-db`, `billing-db`, `marketplace-db` | Present, `PostgreSQL 18` | `postgres:18-alpine` on 5434, 5435, 5436 | Match |
| Kafka relations of the three services | `order.order.*`, `billing.*`, `marketplace.*` and the topics each one consumes | Same topics in `create-topics.sh` | Match |
| `billing-service` technology | `A definir (#11)` | Go 1.27, `net/http`, pgx (ADR-0006) | Stale |
| `marketplace-gateway` technology | `A definir (#12)` | Node.js 22, TypeScript, Express 5 | Stale |
| `billing-db` description | `Cobranças (a definir, #14)` | Tables `invoices` (with payment), `outbox`, `processed_events` | Stale |
| `marketplace-db` description | `Anúncios por marketplace (a definir, #14)` | Tables `listings`, `marketplace_orders`, `order_cursors`, `outbox`, `processed_events` | Stale |

## Goals

- [ ] `make compose-up` starts `order-db`, `billing-db` and `marketplace-db` and all three reach `healthy`.
- [ ] `make compose-topics` creates every topic and DLQ of the event catalog (#8) for the three services.
- [ ] A push that touches only one service runs only that service's workflow, with GitHub Actions runs as evidence.
- [ ] `docs/eventos.md`, the README and the C4 container diagram describe the topics, ports, stacks and databases that actually exist.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Creating databases, compose services, workflows or topics again | Already on `dev` (#15, #16, marketplace-gateway PRs); this feature only closes gaps |
| Vault credentials for `billing-db` and `marketplace-db` | The billing-service and the marketplace-gateway do not read the Vault yet; separate follow-up (ADR-0003) |
| Renaming `produto.analisado.v1` to `compliance.product.analyzed.v1` | Known divergence #3 in `docs/eventos.md`, kept until delivery |
| Kubernetes / kind manifests (`k8s/`, `kind-deploy.yml`) | Separate work; #14 covers only the compose environment and CI |
| Adding Vault, WireMock or the observability stack to the C4 container diagram | They are local-environment infrastructure, not containers of the system; no issue asks for them |
| Other C4 changes (context diagram, relation labels, layout) | The check found no other mismatch with the #14 infra |
| CD (image push on `main`) | Each workflow already has it; #14 asks only for CI isolation |
| Automated consistency check between `docs/eventos.md` and `create-topics.sh` | Not requested; it can be proposed later if the drift happens again |
| Updating the checklist or closing #14 on GitHub | Outward-facing; done only with an explicit go-ahead from the owner |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Compose file name | The issue's `compose.yaml` means the root `docker-compose.yaml` | It is the only compose file in the repo | y |
| Work already delivered | Verify what exists and fix only the gaps found; no rewrite | Rebuilding delivered infra adds risk without value | n |
| Billing stack | `billing-service.yml` calls `_go-service.yml`, which already exists | The issue says to create the reusable workflow of a new stack; Go was chosen in ADR-0006 | y |
| Topic set in scope | The 13 topics in the "Tópicos novos para o `create-topics.sh` (#14)" section of `docs/eventos.md`, plus the earlier `order.order.placed.v1` and `order.order.cancelled.v1` | That section is the #14 list agreed in #8; `compliance.product.analyzed.v1` is only a suggested rename | y |
| Topic shape | Events: 3 partitions; DLQs: 1 partition, `retention.ms=1209600000` (14 days) | The convention already used by every topic in the script | y |
| Stale `docs/eventos.md` section | Replace the pending list with a sentence saying every topic of the catalog is in the script, pointing to `create-topics.sh` | Keeping the list duplicates the script and drifts again | n |
| Meaning of "a push dispara só o CI dele" | A push changing only `<service>/**` runs only `<service>.yml`. A push changing a reusable workflow runs every service that uses it | That is how the `paths` filters of ADR-0001 work; the reusable workflow is part of each caller's pipeline | y |
| Extra paths of `marketplace-gateway.yml` | Changes to `docker/wiremock/{amazon,mercadolivre,shopee}` and `scripts/simulate-*.sh` also run it, and that is correct | Its tests run against those simulators; no other service owns those paths | y |
| CI evidence | Existing GitHub Actions runs of `dev` commits that touch a single service, read with `gh run list --commit <sha>` | It proves the real behaviour without pushing test commits | n |
| C4 descriptions of the new databases | `billing-db`: `Faturas, pagamentos, outbox e inbox`; `marketplace-db`: `Anúncios, pedidos recebidos, cursores de polling, outbox e inbox` | Same style as `order-db` (`Pedidos, outbox e inbox`), taken from the migrations on `dev` | n |
| C4 technology of the new services | `billing-service`: `Go 1.27, net/http`; `marketplace-gateway`: `Node.js 22, TypeScript, Express 5` | Same style as `order-service`, taken from `go.mod`, `package.json` and the Dockerfile | n |
| C4 PNG export | Edit the `c4Technology` and `c4Description` attributes in the `.drawio` XML; re-export the container PNG in draw.io desktop | The draw.io CLI is not installed here; the PNG is what the README and the delivery show | n |
| Makefile target names | `make compose-up`, `make compose-up-infra`, `make compose-topics`, `make compose-ps`, `make compose-clean` | The issue says `make up` and `make topics`; `dev` renamed the targets after the issue was written, and they run the same `docker compose` commands | y |
| Spec language and location | English, source in `.specs/features/new-services-infra/`, copy in `docs/specs/plataforma/infra-servicos-novos/spec.md` | Same convention as the order-service and billing-service specs. The first level of `docs/specs/` is the service; #14 belongs to no service, so it uses `plataforma`, the area name of the issue label and the `[plataforma]` issue prefix, with the folder name in Portuguese like the latest specs (`pedidos`, `anuncios`, `preco`) | y |

**Open questions:** none - all resolved or logged above. Rows marked `n` are the defaults the owner confirms when approving this spec.

---

## User Stories

### P1: Databases of the new services ⭐ MVP

**User Story**: As a developer of order-service, billing-service or marketplace-gateway, I want `make compose-up` to start my service's own Postgres so that I can run migrations and integration tests on the shared environment.

**Why P1**: First acceptance criterion of #14; every service bootstrap depends on it.

**Acceptance Criteria**:

1. WHEN `make compose-up` runs THEN the compose SHALL start `order-db` on host port 5434, `billing-db` on host port 5435 and `marketplace-db` on host port 5436, all from `postgres:18-alpine`.  <!-- event-driven -->
2. WHEN `make compose-up` has run for 60 s THEN `docker inspect` SHALL report health status `healthy` for `order-db`, `billing-db` and `marketplace-db`.  <!-- event-driven -->
3. The compose SHALL mount the named volumes `order-db-data`, `billing-db-data` and `marketplace-db-data` at `/var/lib/postgresql` of their database containers.  <!-- ubiquitous -->
4. WHEN `make compose-up-infra` runs THEN the compose SHALL start the three databases and SHALL NOT start `order-service`, `billing-service` or `marketplace-gateway`.  <!-- event-driven -->
5. IF `ORDER_DB_PASSWORD` is missing from `.env` THEN `docker compose config` SHALL fail with an error containing `run make env`.  <!-- unwanted -->

**Independent Test**: `make compose-up-infra`, wait 60 s, then `docker inspect -f '{{.State.Health.Status}}' order-db billing-db marketplace-db` prints `healthy` three times and `make compose-ps` shows none of the three applications.

---

### P1: Kafka topics of the new services ⭐ MVP

**User Story**: As the owner of a producer or consumer, I want `make compose-topics` to create the topics and DLQs of the event catalog so that the services do not depend on topic auto-creation.

**Why P1**: Second part of the first acceptance criterion of #14.

**Acceptance Criteria**:

1. WHEN `make compose-topics` runs THEN `kafka-init` SHALL create `order.order.placed.v1`, `order.order.cancelled.v1`, `order.order.confirmed.v1`, `marketplace.order.received.v1`, `marketplace.listing.published.v1`, `marketplace.listing.failed.v1`, `billing.invoice.issued.v1`, `billing.payment.confirmed.v1` and `billing.payment.failed.v1` with 3 partitions each.  <!-- event-driven -->
2. WHEN `make compose-topics` runs THEN `kafka-init` SHALL create `order.marketplace-order.dlq`, `order.stock-response.dlq`, `order.billing-payment.dlq`, `marketplace.catalog-product.dlq`, `marketplace.order-cancelled.dlq` and `billing.order-events.dlq` with 1 partition and `retention.ms=1209600000` each.  <!-- event-driven -->
3. WHEN `make compose-topics` runs on a broker where the topics already exist THEN `kafka-init` SHALL exit with code 0 and SHALL leave the partition count of every existing topic unchanged.  <!-- event-driven -->
4. The `docs/eventos.md` file SHALL NOT list as pending any topic that `docker/kafka/create-topics.sh` already creates.  <!-- ubiquitous -->

**Independent Test**: `make compose-topics`, then `docker compose exec kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:19092 --describe --topic <topic>` shows the partition count and `retention.ms` above for each topic; a second `make compose-topics` finishes with `kafka-init` exited 0.

---

### P1: Isolated CI per service ⭐ MVP

**User Story**: As a team member, I want a push to one service to run only that service's pipeline so that the CI stays fast and a failure points to the service that broke it.

**Why P1**: Second acceptance criterion of #14 (ADR-0001).

**Acceptance Criteria**:

1. The `order-service.yml` and `marketplace-gateway.yml` workflows SHALL call `_node-service.yml`, and `billing-service.yml` SHALL call `_go-service.yml`.  <!-- ubiquitous -->
2. WHEN a push changes only files under `order-service/` THEN GitHub Actions SHALL run the `order-service` workflow and SHALL NOT run `billing-service`, `marketplace-gateway`, `catalog-service`, `compliance-service` or `bff-gateway`.  <!-- event-driven -->
3. WHEN a push changes only files under `billing-service/` THEN GitHub Actions SHALL run the `billing-service` workflow and SHALL NOT run any other service workflow.  <!-- event-driven -->
4. WHEN a push changes only files under `marketplace-gateway/` THEN GitHub Actions SHALL run the `marketplace-gateway` workflow and SHALL NOT run any other service workflow.  <!-- event-driven -->
5. WHEN a push changes only `.github/workflows/_node-service.yml` THEN GitHub Actions SHALL run the workflows of every service that calls it (`catalog-service`, `order-service`, `marketplace-gateway`).  <!-- event-driven -->

**Independent Test**: for a `dev` commit that touches only one service, `gh run list --commit <sha> --json workflowName` lists only that service's workflow.

---

### P2: Ports and components documented

**User Story**: As a new team member, I want the README to list the port, stack and database of each service so that I can reach them without reading the compose file.

**Why P2**: Part of the #14 checklist; it does not block the services from running.

**Acceptance Criteria**:

1. The compose SHALL publish `order-service` on host port 8084, `billing-service` on host port 8086 and `marketplace-gateway` on host port 8087.  <!-- ubiquitous -->
2. The compose SHALL publish host port 8085 only for `keycloak`.  <!-- ubiquitous -->
3. The README services table SHALL list `order-service` with port 8084, `billing-service` with port 8086 and `marketplace-gateway` with port 8087.  <!-- ubiquitous -->
4. The README components table SHALL list `order-db` on `localhost:5434`, `billing-db` on `localhost:5435` and `marketplace-db` on `localhost:5436`, each with its user and password source.  <!-- ubiquitous -->

**Independent Test**: `docker compose config --format json | jq` shows the published ports above and the README tables match them.

---

### P2: C4 container diagram matches the new services

**User Story**: As a reader of the architecture (team or evaluator), I want the C4 container diagram to show the real stack and data of the new services so that it does not contradict the code at delivery.

**Why P2**: The diagram points to #14 for the content of two databases; it does not block the services from running.

**Acceptance Criteria**:

1. The C4 container diagram SHALL show `billing-service` with technology `Go 1.27, net/http`.  <!-- ubiquitous -->
2. The C4 container diagram SHALL show `marketplace-gateway` with technology `Node.js 22, TypeScript, Express 5`.  <!-- ubiquitous -->
3. The C4 container diagram SHALL describe `billing-db` as `Faturas, pagamentos, outbox e inbox` and `marketplace-db` as `Anúncios, pedidos recebidos, cursores de polling, outbox e inbox`.  <!-- ubiquitous -->
4. The `.drawio` file and the container PNG SHALL contain no `a definir` text, in any letter case.  <!-- ubiquitous -->

**Independent Test**: `grep -ci 'a definir' "docs/c4/Omni Market - C4 Model Contexto.drawio"` prints `0`, and the re-exported container PNG shows the four labels above.

---

## Edge Cases

- IF a host port among 5434, 5435, 5436, 8084, 8086 or 8087 is already in use THEN `make compose-up` SHALL fail for that container with Docker's `port is already allocated` error and SHALL leave the other containers running.
- IF Kafka is not healthy THEN `kafka-init` SHALL NOT start, because it depends on `kafka` with `condition: service_healthy`.
- WHEN a database volume already exists from an older `.env` THEN Postgres SHALL keep its original password, and the fix SHALL be `make compose-clean` (documented in `CLAUDE.md`).

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| PLAT-01 | P1: Databases - three databases on 5434/5435/5436 | T2 | Implementing |
| PLAT-02 | P1: Databases - healthy within 60 s | T2 | Implementing |
| PLAT-03 | P1: Databases - named volumes | T2 | Implementing |
| PLAT-04 | P1: Databases - `make compose-up-infra` leaves the apps out | T2 | Implementing |
| PLAT-05 | P1: Databases - missing password fails with `run make env` | T2 | Implementing |
| PLAT-06 | P1: Topics - 9 event topics, 3 partitions | T3 | Implementing |
| PLAT-07 | P1: Topics - 6 DLQs, 1 partition, 14 days | T3 | Implementing |
| PLAT-08 | P1: Topics - `make compose-topics` is idempotent | T3 | Implementing |
| PLAT-09 | P1: Topics - `docs/eventos.md` lists nothing already created | T1 | Implementing |
| PLAT-10 | P1: CI - each workflow calls its stack's reusable workflow | T4 | Implementing |
| PLAT-11 | P1: CI - push to `order-service/` runs only its CI | T5 | Implementing |
| PLAT-12 | P1: CI - push to `billing-service/` runs only its CI | T5 | Implementing |
| PLAT-13 | P1: CI - push to `marketplace-gateway/` runs only its CI | T5 | Implementing |
| PLAT-14 | P1: CI - change to `_node-service.yml` runs every caller | T5 | Implementing |
| PLAT-15 | P2: Ports - 8084/8086/8087 published | T2 | Implementing |
| PLAT-16 | P2: Ports - 8085 only for Keycloak | T2 | Implementing |
| PLAT-17 | P2: Ports - README services table | T6 | Implementing |
| PLAT-18 | P2: Ports - README components table | T6 | Implementing |
| PLAT-19 | P2: C4 - `billing-service` technology | T7 | Implementing |
| PLAT-20 | P2: C4 - `marketplace-gateway` technology | T7 | Implementing |
| PLAT-21 | P2: C4 - `billing-db` and `marketplace-db` descriptions | T7 | Implementing |
| PLAT-22 | P2: C4 - no `a definir` left in `.drawio` or PNG | T7 | Implementing (PNG export pending) |

**ID format:** `PLAT-NN` (platform).

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 22 total, 22 mapped to tasks, 0 unmapped.

---

## Success Criteria

- [ ] Every PLAT requirement is `Verified`, with the command output or GitHub Actions run cited in `validation.md`.
- [ ] Both acceptance criteria of #14 are shown by evidence, with no infra rebuilt.
- [ ] No topic, port or database listed in `docs/eventos.md` or the README is missing from the compose or `create-topics.sh`, and none in them is missing from the docs.
- [ ] The C4 container diagram has no element marked "a definir".
