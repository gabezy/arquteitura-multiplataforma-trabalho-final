# e2e-smoke Validation (iteration 3 of 3)

**Date**: 2026-10-24
**Spec**: `.specs/features/e2e-smoke/spec.md` (24 ACs, E2E-01..E2E-24, plus 4 edge cases)
**Diff range**: `dev..feature/37-e2e` (a837d91..dce20ab, 8 commits). Iteration 3 re-checks fix commit dce20ab. The branch was verified as it is, without merging origin/dev.
**Verifier**: independent sub-agent (author ≠ verifier)
**Result**: PASS - 24/24 ACs have discriminating evidence, gate 25/25, sensor 3/3 killed this iteration (11/11 distinct mutants killed in their final state across the three iterations)

---

## Iteration history

| Iteration | Commit | Gate | Sensor | Verdict | Gaps |
| --------- | ------ | ---- | ------ | ------- | ---- |
| 1 | 187c4fa | 21/21 | 3/5 killed | FAIL | M1 (E2E-06 401 check) and M2 (E2E-09 `reserved`-message check) survived |
| 2 | 3d835d1 | 24/24 | 4/5 killed | FAIL | M7 (E2E-07 `importedProducts` = 3) survived; the catalog-isolation edge check was order-sensitive (`HTTP 000`) |
| 3 | dce20ab | 25/25 | 3/3 killed | PASS | none blocking |

How each gap was closed:
- **Iteration 1 -> 2**:
  - E2E-06: a harness run with `BFF_PORT=8082` sends the request without a token to catalog, which answers 404.
  - E2E-09: a new AC, E2E-24, adds `E2E_ORDER_ID`. The harness publishes a decoy `reserved` message keyed by that id before the run.
  - The `importedProducts` regex is anchored, and the summary is checked on a failure run.
- **Iteration 2 -> 3**:
  - E2E-07: two WireMock stubs act as a fake BFF. The first answers 401 when `Authorization` is absent; the second answers 200 `{"importedProducts":2}` (`scripts/e2e-smoke.test.sh:138-148`). Both are removed right after the run and in the `restore` trap (`:36-41`).
  - Catalog-isolation edge: the harness accepts `HTTP 500: {..."status":500...}` or `HTTP 000: ` (`:134`).
  - The script no longer prints a stray `cat` error when there is no response body (`scripts/e2e-smoke.sh:93`).

---

## Task Completion

Medium scope, so there is no `tasks.md` or `design.md`. All 8 feature commits are on `feature/37-e2e`.

---

## Spec-Anchored Acceptance Criteria

Harness = `scripts/e2e-smoke.test.sh`; script under test = `scripts/e2e-smoke.sh`.

| ID | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------- | ----------------------- | ------ |
| E2E-01 | `make e2e` runs `scripts/e2e-smoke.sh` | `scripts/e2e-smoke.test.sh:55` - `[ "$(make_out -n e2e)" = "bash scripts/e2e-smoke.sh" ]` (Makefile:34-35) | ✅ PASS |
| E2E-02 | runs `docker compose up -d --build` without `E2E_SKIP_UP=1` | `scripts/e2e-smoke.test.sh:62` - `has "Subindo o ambiente (docker compose up -d --build)"` | ✅ PASS (proxy through the banner at e2e-smoke.sh:68, which sits in the same `if` as the call at :69; see O2) |
| E2E-03 | no `docker compose up` with `E2E_SKIP_UP=1` | `scripts/e2e-smoke.test.sh:71` - `! has "Subindo o ambiente"` | ✅ PASS (same proxy) |
| E2E-04 | waits for the 5 apps to be healthy, at most `E2E_TIMEOUT` (300) | `scripts/e2e-smoke.test.sh:63-64` - ok_lines start with `[OK] ambiente`; `:103` - `has "...apos 5s: order-service=exited"` | ✅ PASS (only order-service is faulted; see O3) |
| E2E-05 | admin token from Keycloak | `scripts/e2e-smoke.test.sh:64`; `:127` - `has "[FALHA] autenticacao: o Keycloak respondeu HTTP 000 sem access_token"` | ✅ PASS |
| E2E-06 | request without a token gets `401` from the BFF, and the script checks it | `scripts/e2e-smoke.test.sh:110` - `[ "$code" = 1 ] && has "[FALHA] autenticacao: importacao sem token respondeu HTTP 404, esperado 401"` | ✅ PASS (M1 killed, iteration 2) |
| E2E-07 | `200` with `importedProducts` = 3 | `scripts/e2e-smoke.test.sh:148` - `[ "$code" = 1 ] && has "[FALHA] importacao: HTTP 200: {\"importedProducts\":2}"`; `:134` (non-200) | ✅ PASS (M7 killed, iteration 3) |
| E2E-08 | within 60 s: A `APPROVED`, B and C `REJECTED` | `scripts/e2e-smoke.test.sh:64`; `:95` - `has "esperado 'APPROVED', ultimo valor 'PENDING' apos 60s"` | ✅ PASS |
| E2E-09 | placed (1 unit, new UUID) -> stock 1 and one `reserved` message keyed by the order id | `scripts/e2e-smoke.test.sh:77-78` - exact ok_lines; `:120` - `has "[FALHA] estoque: reserva: mensagens em catalog.stock.reserved.v1 com a chave $order_id: esperado '1', ultimo valor '2'"` | ✅ PASS (M2 killed in iteration 2; M10, a fixed default order id, killed in iteration 3) |
| E2E-10 | cancelled -> stock back to 2 within 60 s | `scripts/e2e-smoke.test.sh:77-78` - `[OK] estoque: devolucao` in the exact sequence | ✅ PASS (happy path only; see O4) |
| E2E-11 | one `[OK] <step>` per step, exit 0 | `scripts/e2e-smoke.test.sh:77-78`; `:72` - `[ "$code" = 0 ]` | ✅ PASS |
| E2E-12 | `[FALHA] <step>: <reason>`, exit 1, later steps not run | `scripts/e2e-smoke.test.sh:93-94` - `has "[FALHA] compliance: analysisStatus de E2E-"`; `:96` - `! has "[OK] estoque" && ! has "[PENDENTE]"` | ✅ PASS (M5 killed, iteration 1) |
| E2E-13 | stack timeout fails `ambiente` and lists the unhealthy services | `scripts/e2e-smoke.test.sh:102-103` | ✅ PASS |
| E2E-14 | async timeout prints the last observed value | `scripts/e2e-smoke.test.sh:95` | ✅ PASS |
| E2E-15 | every SKU suffixed with a per-run id | `scripts/e2e-smoke.test.sh:74` - `[ "$first_run" != "$second_run" ]` | ✅ PASS (M4 killed, iteration 1) |
| E2E-16 | two runs on the same environment both exit 0 | `scripts/e2e-smoke.test.sh:72`, `:152` - `[ "$code" = 0 ]` | ✅ PASS |
| E2E-17 | no down/rm/volume rm; every volume survives | `scripts/e2e-smoke.test.sh:155` (volumes), `:156-157` (container ids); no `down`/`rm` in e2e-smoke.sh | ✅ PASS |
| E2E-18 | four `[PENDENTE]` lines | `scripts/e2e-smoke.test.sh:79-80` - exact 4-line sequence | ✅ PASS |
| E2E-19 | exit 0 when only pending steps remain, no strict | `scripts/e2e-smoke.test.sh:81` | ✅ PASS |
| E2E-20 | exit 1 with `E2E_STRICT=1` | `scripts/e2e-smoke.test.sh:86-87` | ✅ PASS (M3 killed, iteration 1) |
| E2E-21 | summary line when the run ends | `scripts/e2e-smoke.test.sh:82` (success), `:104` - `has "Resumo: 0 ok, 1 falha(s), 0 pendente(s)"` (failure) | ✅ PASS (M8 killed, iteration 2) |
| E2E-22 | README: `make e2e`, prerequisites, variables | inspection: `README.md:102`, `README.md:106`, `README.md:112-116` | ✅ PASS (doc AC) |
| E2E-23 | `e2e` in `make help` | `scripts/e2e-smoke.test.sh:56` | ✅ PASS |
| E2E-24 | `E2E_ORDER_ID` replaces the generated order id | `scripts/e2e-smoke.test.sh:113-120` - the failure message must name the harness's `$order_id` with count 2 | ✅ PASS (M6 killed, iteration 2) |

**Status**: ✅ All 24 ACs covered with spec-anchored, discriminating assertions. 0 spec-precision gaps.

---

## Edge Cases

- [x] Keycloak returns no token: `scripts/e2e-smoke.test.sh:123-127`.
- [x] BFF answers something other than 200 on the import, so the script prints the status and body: `scripts/e2e-smoke.test.sh:130-134`. It accepts `HTTP 500: {...}` or `HTTP 000: `. M9 (the status in the message hard-coded to `HTTP 200`) was killed by this check.
- [x] Git Bash without `MSYS_NO_PATHCONV` set by the caller: `scripts/e2e-smoke.sh:104,109` set it only on the `docker exec` calls. The gate ran on Git Bash without exporting it.
- [~] The spreadsheet cannot be created: **no test**, a gap the author declared and accepted. Reading `scripts/e2e-smoke.sh:87-89`, `docker run ... > xlsx && [ -s xlsx ] || fail importacao` runs before the curl at :90, so the code is correct by inspection. Injecting this fault would need a test-only setting. Not blocking.

---

## Gate Check

- **Gate command**: `bash scripts/e2e-smoke.test.sh` (real tree, live stack, commit dce20ab)
- **Outcome**: 25 checks passed, 0 failed, 0 skipped; exit 0; 323 s. No `e2e00000-*` stub was left in WireMock afterwards.
- **Test count before feature**: 0
- **Test count after feature**: 25 (iteration 1: 21; iteration 2: 24; +1 E2E-07 count scenario)
- **Skipped tests**: none
- **Weakened assertions**: the catalog-isolation edge check now accepts `HTTP 000` as well as `HTTP 500`. This is justified: the spec outcome is "fail the import step and print the status and body", and both forms satisfy it. The previous exact-500 check depended on what the scenario before it had done (seen in iteration 2, M2 and M6 runs).

---

## Discrimination Sensor

Procedure (iteration 3):
- I used a temporary `git worktree` at dce20ab (`core.longpaths=true`) and mutated only `scripts/e2e-smoke.sh` there.
- The worktree's own harness ran in full for every mutant, and `git checkout -- <file>` restored the file between mutants.
- `COMPOSE_FILE` and `COMPOSE_PROJECT_NAME` pointed at the real compose project. No `git stash`.

Cleanup:
- The WireMock `e2e00000-*` stub count was 0 after every mutant run.
- Baseline porcelain (the 3 untracked verifier/lessons files) matched after cleanup.
- The worktree is removed.
- All 5 apps are healthy and on `arquteitura-multiplataforma-trabalho-final_default`.

| Mutation | Iter. | File:line | Description | Killed? |
| -------- | ----- | --------- | ----------- | ------- |
| M7 (re-run) | 3 | `scripts/e2e-smoke.sh:92` | `'"importedProducts":3[,}]'` -> `'"importedProducts":[0-9]+'` | ✅ Killed (E2E-07 check `:148`) |
| M9 (new) | 3 | `scripts/e2e-smoke.sh:93` | `fail importacao "HTTP $status: ..."` -> `"HTTP 200: ..."` (status not printed) | ✅ Killed (edge check `:134`) |
| M10 (new) | 3 | `scripts/e2e-smoke.sh:113-114` | default order id -> fixed `e2e-fixed-order` (not a new UUID per run) | ✅ Killed (7 failures: the second run's stock stays 2, so E2E-16, E2E-09/10, E2E-18..21 and the final normal run fail) |
| M1 | 1 -> 2 | `scripts/e2e-smoke.sh:84` | 401 check -> `true` | survived in iteration 1, ✅ killed in iteration 2 |
| M2 | 1 -> 2 | `scripts/e2e-smoke.sh:120-121` | `reserved`-message wait deleted | survived in iteration 1, ✅ killed in iteration 2 |
| M3 | 1 | `scripts/e2e-smoke.sh:136` | strict `= 1` -> `= 0` | ✅ Killed |
| M4 | 1 | `scripts/e2e-smoke.sh:21` | run id fixed per day | ✅ Killed |
| M5 | 1 | `scripts/e2e-smoke.sh:40` | `fail` exits 0 | ✅ Killed |
| M6 | 2 | `scripts/e2e-smoke.sh:113` | `E2E_ORDER_ID` ignored | ✅ Killed |
| M8 | 2 | `scripts/e2e-smoke.sh:39` | `summary` removed from `fail()` | ✅ Killed |

**Sensor depth**: expanded (11 distinct mutants across 3 iterations, 3 this iteration)
**Outcome**: 3/3 killed this iteration; every mutant is killed in its final state

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ - script 139 lines; the fix commits only add harness scenarios, one parameter expansion (`E2E_ORDER_ID`) and a `2> /dev/null` |
| Surgical changes | ✅ - only `scripts/`, `Makefile` (e2e target and help regex), the `README.md` section, `.gitattributes`, and the spec (E2E-24 + Assumptions row) |
| No scope creep | ✅ - matches Out of Scope; the one test setting (`E2E_ORDER_ID`) is declared as an AC and documented |
| Matches patterns | ✅ - `## ` Makefile help convention; Portuguese/ASCII output; Conventional Commits in Portuguese with `Refs #37` |
| Spec-anchored outcome check | ✅ - every AC's asserted value is the spec-defined value (401, 3 products, APPROVED/REJECTED, stock 1/2, one keyed message, exit codes, exact lines and summary) |
| Per-layer coverage (happy + edge + error per step) | ✅ with noted exceptions: devolucao and spreadsheet creation have only happy-path/inspection evidence (O4, edge case 4) |
| Every test maps to a spec requirement | ✅ - all 25 checks carry an E2E id or an edge-case tag |
| Documented guidelines followed: root `CLAUDE.md` | ✅ |

---

## Ranked Observations (non-blocking)

1. **O1 (follow-up for the dev-merge PR, deferred by the owner)** - the E2E-09/24 scenario publishes a decoy to the real `catalog.stock.reserved.v1` topic (`scripts/e2e-smoke.test.sh:113-117`). It has no CloudEvents headers, `items: []` and an order id nothing knows. On origin/dev, order-service consumes that topic (`order-service/src/infra/messaging/stock-response.topics.ts`, `order-outcome.consumer`). The next PR, which merges dev and automates listing, marketplace order, confirmation and billing, should check that order-service ignores or rejects the decoy cleanly, or switch to a fault that does not write to a shared topic. This is not a blocker for v1 on the current base.
2. **O2 (Minor)** - E2E-02/03 are checked through the banner, not the `docker compose up` call itself (`scripts/e2e-smoke.test.sh:62,71`).
3. **O3 (Minor)** - E2E-04 proves only that `order-service` is in the health list (`scripts/e2e-smoke.test.sh:103`). By reading the harness, dropping another app from `APPS` would go unnoticed.
4. **O4 (Minor)** - E2E-10 (devolucao) has no failure scenario. Its check uses the same `wait_for` path that M7/M10 showed to discriminate, but the step itself is not faulted.
5. **O5 (Minor, accepted)** - the spreadsheet-creation edge case is not tested; the code is correct by inspection.
6. **O6 (Info)** - `docker-compose.yaml` has no `name:` key. Running the harness from another checkout starts a second compose project on its first run (the one without `E2E_SKIP_UP=1`). The sensor worked around it with `COMPOSE_FILE`/`COMPOSE_PROJECT_NAME`.
7. **O7 (Info)** - every harness and sensor run leaves test products (`E2E-<run>-{A,B,C}`) and test messages in the local stack, as the spec allows (no teardown is in scope).

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| ----------- | --------------- | ---------- |
| E2E-01..E2E-24 | Implementing | ✅ Verified |

(The Verifier did not edit spec.md; the orchestrator updates statuses.)

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 24/24 ACs matched the spec outcome, 0 spec-precision gaps
**Sensor**: 3/3 mutations killed this iteration; 11/11 distinct mutants killed in their final state
**Gate**: 25 passed, 0 failed

**What works**:
- The full v1 flow on Git Bash: environment, authentication (token + 401), import (status + exact count), compliance, stock reservation (stock + keyed message) and stock return.
- Fail-fast behavior with reasons and summary, the stack timeout, strict mode, the pending list, repeatability and no deletion.
- README and `make help`.

**Next steps**: open the v1 PR (Refs #37). Carry O1 into the follow-up PR that merges dev.
