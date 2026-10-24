# E2E smoke test (`make e2e`) Specification

Issue: #37 · Owner: Natan de Almeida Figueiredo · Date: 2026-10-24 · Scope: Medium (v1)

## Problem Statement

The demo script (#27) proves the flow by hand, and nothing re-checks it when a service changes. Issue #37 asks for an automated test that brings the environment up, imports a spreadsheet through the BFF and verifies each step of the flow by API, so that `make e2e` passes from scratch on a clean machine with Docker before the final delivery (11/11). This v1 automates the steps that exist today (authentication, import, compliance, stock) and reports the steps of services that do not exist yet as pending, so the script grows with #20, #21, #22 and #23 instead of failing or passing falsely.

## Goals

- [ ] `make e2e` brings the stack up and verifies authentication, import, compliance and stock, ending with exit code 0 when they work.
- [ ] A broken step makes the run end with exit code 1 and names the step that failed.
- [ ] The test can run again on the same environment, without `make clean`, and pass again.
- [ ] The steps that depend on order, marketplace and billing are listed as pending, and `E2E_STRICT=1` turns them into failures for the final delivery.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Automating the listing, marketplace order, order confirmation and billing steps | The services do not exist yet (#20, #21, #22, #23); they are reported as pending and added in the final version of #37 |
| GitHub Actions `workflow_dispatch` job | Optional in #37; comes with the final version, once the full flow exists |
| Fixing the BFF 500 on a repeated import | Belongs to the bff-gateway front (found in the #27 rehearsal) |
| Tearing the environment down or wiping volumes | Destructive to the developer's local data; `make clean` stays a manual step |
| Load, performance or chaos testing | Not asked by #37 |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Prerequisites | `bash`, `curl` and Docker with Compose; `make` only for the `make e2e` shortcut | #37: "numa máquina limpa com Docker"; the Windows dev machine has no `jq`, `make` or reliable `python` | y |
| Spreadsheet | Generated on every run with SKUs suffixed by a run id, by a throwaway `python:3.13-alpine` container that writes the xlsx to stdout | The catalog rejects repeated SKUs, so a fixed file only passes once per environment; a container keeps Docker as the only prerequisite | y |
| Bringing the stack up | The script runs `docker compose up -d --build` and waits for the five apps to be healthy, unless `E2E_SKIP_UP=1` | #37 says the script "sobe a infra"; `up -d` is a no-op on a running stack; skipping helps when the stack is already up | y |
| JSON parsing | `grep`/`sed` on the response bodies | No `jq` on the target machines | y |
| Order events in v1 | The test publishes `order.order.placed.v1` and `order.order.cancelled.v1` itself through the Kafka broker, the plan B of the demo | The order-service has no domain yet (#20) | y |
| Pending steps | Listing, marketplace order, order confirmation and billing are always reported `PENDENTE` in v1 | They cannot be automated before the services and contracts exist; reporting them keeps the gap visible | y |
| Timeouts | Stack health 300 s (`E2E_TIMEOUT`), each asynchronous check 60 s | The cold Keycloak start took about 2 min in the rehearsal; the outbox relay polls every second | y |
| Ports | BFF on `BFF_PORT` (default 8080); catalog 8082, Keycloak 8085, same as the compose | The compose lets only `BFF_PORT` and `GRAFANA_PORT` change | y |
| Script location and name | `scripts/e2e-smoke.sh` at the repository root, target `e2e` in the root `Makefile` | Suggested by #37 | y |
| What "never deletes" covers (E2E-17) | No `down`, `rm` or `volume rm`; every volume survives. Containers that `docker compose up --build` recreates because an image changed do not count | Found during Execute: the first harness run saw catalog and compliance recreated by the compose up, with their volumes intact; that is compose's normal behavior, not data loss | y |
| Output language | Report lines in Portuguese (`[OK]`, `[FALHA]`, `[PENDENTE]`), ASCII only | The team's docs are in Portuguese; ASCII avoids broken characters in the Windows console | y |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: Run the flow end to end with one command ⭐ MVP

**User Story**: As a team member, I want `make e2e` to verify the whole implemented flow so that I know the demo still works after any change.

**Why P1**: The acceptance criterion of #37.

**Acceptance Criteria**:

1. WHEN `make e2e` runs THEN the Makefile SHALL run `scripts/e2e-smoke.sh`.  <!-- event-driven -->
2. WHEN the script starts without `E2E_SKIP_UP=1` THEN the script SHALL run `docker compose up -d --build` from the repository root.  <!-- event-driven -->
3. WHERE `E2E_SKIP_UP=1` is set the script SHALL not run `docker compose up`.  <!-- optional-feature -->
4. WHEN the stack is starting THEN the script SHALL wait until `bff-gateway`, `catalog-service`, `compliance-service`, `order-service` and `keycloak` report `healthy`, for at most `E2E_TIMEOUT` seconds (default 300).  <!-- event-driven -->
5. WHEN the stack is healthy THEN the script SHALL get an access token for the `admin` user from Keycloak.  <!-- event-driven -->
6. WHEN the script imports the spreadsheet through `POST /catalog/import/xlsx` without a token THEN the BFF SHALL answer `401`, and the script SHALL check it.  <!-- event-driven -->
7. WHEN the script imports the generated spreadsheet with the admin token THEN the script SHALL check that the BFF answers `200` with `importedProducts` equal to the number of rows (3).  <!-- event-driven -->
8. WHEN the import succeeded THEN the script SHALL check, within 60 s, that `GET /products/sku/<sku>` shows `analysisStatus` `APPROVED` for the approved product and `REJECTED` for the product with a prohibited term and for the product above the price ceiling.  <!-- event-driven -->
9. WHEN the approved product has stock 2 THEN the script SHALL publish `order.order.placed.v1` for 1 unit with a new UUID order id, and SHALL check within 60 s that the stock becomes 1 and that `catalog.stock.reserved.v1` holds a message keyed by that order id.  <!-- event-driven -->
10. WHEN the reservation succeeded THEN the script SHALL publish `order.order.cancelled.v1` for the same order id and SHALL check within 60 s that the stock returns to 2.  <!-- event-driven -->
11. WHEN every step passes THEN the script SHALL print one `[OK] <step>` line per step and exit with code 0.  <!-- event-driven -->

**Independent Test**: on a running stack, `E2E_SKIP_UP=1 bash scripts/e2e-smoke.sh` prints `[OK]` for authentication, import, compliance and stock, lists the pending steps and exits 0.

---

### P1: Fail loudly on a broken step ⭐ MVP

**User Story**: As a team member, I want a broken step to fail the run and say which step broke so that I know where to look.

**Why P1**: A test that cannot fail is useless.

**Acceptance Criteria**:

1. IF a check fails THEN the script SHALL print `[FALHA] <step>: <reason>` and exit with code 1 without running the next steps.  <!-- unwanted -->
2. IF the stack is not healthy within `E2E_TIMEOUT` seconds THEN the script SHALL fail the stack step and print the services that are not healthy.  <!-- unwanted -->
3. IF an asynchronous check does not reach its expected value within 60 s THEN the script SHALL fail that step and print the last value it observed.  <!-- unwanted -->

**Independent Test**: stop `compliance-service` and run the script with `E2E_SKIP_UP=1`: it prints `[FALHA]` for the compliance step and exits 1.

---

### P1: Repeatable runs ⭐ MVP

**User Story**: As a team member, I want to run the test again on the same environment so that I do not have to wipe my local data between runs.

**Why P1**: #37 must pass "do zero", and the developers run it on their own environment many times.

**Acceptance Criteria**:

1. The script SHALL suffix every SKU of the generated spreadsheet with a run id that is different on every run.  <!-- ubiquitous -->
2. WHEN the script runs twice on the same environment THEN both runs SHALL exit with code 0.  <!-- event-driven -->
3. The script SHALL not run `docker compose down`, `docker rm` or `docker volume rm`, and every volume SHALL still exist after a run.  <!-- ubiquitous -->

**Independent Test**: run the script twice in a row on the same stack; both exit 0.

---

### P1: Pending steps for services that do not exist yet ⭐ MVP

**User Story**: As the owner of the final delivery, I want the steps of the services still under construction listed as pending so that the gap stays visible until they are automated.

**Why P1**: Keeps v1 honest and gives the final version a checklist.

**Acceptance Criteria**:

1. The script SHALL print `[PENDENTE] <step>` for the listing, marketplace order, order confirmation and billing steps.  <!-- ubiquitous -->
2. WHILE `E2E_STRICT` is not `1` the script SHALL exit with code 0 when the only non-passing steps are pending ones.  <!-- state-driven -->
3. WHERE `E2E_STRICT=1` is set the script SHALL exit with code 1 when any step is pending.  <!-- optional-feature -->
4. WHEN the run ends THEN the script SHALL print a summary line with the number of passed, failed and pending steps.  <!-- event-driven -->

**Independent Test**: `E2E_STRICT=1 E2E_SKIP_UP=1 bash scripts/e2e-smoke.sh` exits 1 and the summary counts 4 pending steps.

---

### P2: Documentation

**User Story**: As a team member, I want the test documented where the others look so that I know how to run it.

**Acceptance Criteria**:

1. The root `README.md` SHALL describe `make e2e`, its prerequisites and the `E2E_SKIP_UP`, `E2E_STRICT`, `E2E_TIMEOUT` and `BFF_PORT` variables.  <!-- ubiquitous -->
2. The root `Makefile` SHALL list `e2e` in `make help`.  <!-- ubiquitous -->

**Independent Test**: read the README section and run `make` to see `e2e` listed.

---

## Edge Cases

- IF Keycloak does not return an access token THEN the script SHALL fail the authentication step and print the HTTP status it got.
- IF the BFF answers anything other than `200` on the import THEN the script SHALL fail the import step and print the status and body.
- WHEN the script runs on Git Bash (Windows) THEN the `docker exec` calls SHALL work without the caller setting `MSYS_NO_PATHCONV`.
- IF the generated spreadsheet cannot be created THEN the script SHALL fail the import step before calling the BFF.

### Implicit-requirement sweep

| Dimension | Coverage |
| --- | --- |
| Idempotency / retry / duplicate handling | Run-unique SKUs and order ids (Repeatable runs AC-1, AC-2) |
| Failure / partial-failure states | Stop at the first failed step with its reason (Fail loudly AC-1..3) |
| External-dependency failure | Stack health timeout and per-step timeouts (Fail loudly AC-2, AC-3) |
| Auth boundaries | 401 without token and admin token (Run AC-5, AC-6) |
| Remaining dimensions | N/A for this scope: the script is a test client and holds no state of its own |

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| E2E-01 | P1 Run: `make e2e` runs the script | Execute | Pending |
| E2E-02 | P1 Run: `docker compose up -d --build` | Execute | Implementing |
| E2E-03 | P1 Run: `E2E_SKIP_UP=1` skips the up | Execute | Implementing |
| E2E-04 | P1 Run: waits for the five apps healthy | Execute | Implementing |
| E2E-05 | P1 Run: admin token | Execute | Implementing |
| E2E-06 | P1 Run: 401 without token | Execute | Implementing |
| E2E-07 | P1 Run: import with `importedProducts` 3 | Execute | Implementing |
| E2E-08 | P1 Run: compliance statuses | Execute | Implementing |
| E2E-09 | P1 Run: reservation (stock 1 and `reserved`) | Execute | Pending |
| E2E-10 | P1 Run: cancellation (stock 2) | Execute | Pending |
| E2E-11 | P1 Run: `[OK]` lines and exit 0 | Execute | Implementing |
| E2E-12 | P1 Fail: `[FALHA]` and exit 1, stop | Execute | Implementing |
| E2E-13 | P1 Fail: stack timeout lists unhealthy services | Execute | Implementing |
| E2E-14 | P1 Fail: async timeout prints last value | Execute | Implementing |
| E2E-15 | P1 Repeat: run-unique SKUs | Execute | Implementing |
| E2E-16 | P1 Repeat: two runs pass | Execute | Implementing |
| E2E-17 | P1 Repeat: no deletion | Execute | Implementing |
| E2E-18 | P1 Pending: four `[PENDENTE]` lines | Execute | Pending |
| E2E-19 | P1 Pending: exit 0 without strict | Execute | Pending |
| E2E-20 | P1 Pending: exit 1 with `E2E_STRICT=1` | Execute | Pending |
| E2E-21 | P1 Pending: summary line | Execute | Pending |
| E2E-22 | P2 Docs: README section | Execute | Pending |
| E2E-23 | P2 Docs: `e2e` in `make help` | Execute | Pending |

**Coverage:** 23 total, 23 mapped to Execute, 0 unmapped

---

## Success Criteria

- [ ] On a clean machine with Docker, `make e2e` passes from scratch.
- [ ] Two consecutive runs on the same environment both pass.
- [ ] Stopping any service the flow uses makes the run fail at the matching step.
