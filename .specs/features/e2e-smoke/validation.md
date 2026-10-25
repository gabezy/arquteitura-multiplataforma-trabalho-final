# e2e-smoke Validation (post-merge re-verification + owner decision)

**Date**: 2026-10-24 (owner decision recorded 2026-10-25)
**Spec**: `.specs/features/e2e-smoke/spec.md` (25 ACs, E2E-01..E2E-25, plus 4 edge cases)
**Diff range**: `dev..feature/37-e2e` at 5e5da82. 5e5da82 touches only spec.md and README.md, so the 245eaec gate and sensor still apply. This pass re-checks merge 234e673 (origin/dev into the branch) and the Vault adaptation 245eaec on top of the iteration-3 PASS at dce20ab.
**Verifier**: independent sub-agent (author ≠ verifier)
**Result**: PASS - 25/25 ACs covered. 24 have discriminating harness evidence; E2E-02 is covered by a declared limitation the owner accepted (spec.md Assumptions "How E2E-02 is verified", commit 5e5da82). Gate 26/26. Sensor: MA and MC killed; MB survives by design under that declared limitation.

---

## Iteration history

| Pass | Commit | Gate | Sensor | Verdict | Gaps |
| ---- | ------ | ---- | ------ | ------- | ---- |
| 1 | 187c4fa | 21/21 | 3/5 killed | FAIL | M1 (E2E-06 401 check) and M2 (E2E-09 `reserved` message) survived |
| 2 | 3d835d1 | 24/24 | 4/5 killed | FAIL | M7 (E2E-07 `importedProducts` = 3) survived; catalog-isolation edge check was order-sensitive |
| 3 | dce20ab | 25/25 | 3/3 killed | PASS | none blocking; O2 noted that E2E-02's `docker compose up` was asserted only through the banner |
| post-merge | 245eaec | 26/26 | 2/3 killed | FAIL | MB (E2E-02 `generate-env.sh` call) survived |
| post-merge, owner decision | 5e5da82 | 26/26 (245eaec result applies; no code/test change) | 2/3 killed, MB accepted | PASS | none blocking; MB closed as a declared limitation (option B) |

What changed after the iteration-3 PASS:
- **Merge 234e673**:
  - The Makefile follows dev (`compose-*` targets), and `e2e` now depends on `env` (Makefile:120).
  - The README keeps dev's Vault section and the E2E section.
  - The lessons stores were merged.
- **Commit 245eaec**:
  - The script reads the client secret from `BFF_CLIENT_SECRET`, falling back to `.env` (`scripts/e2e-smoke.sh:82-83`).
  - It runs `sh scripts/generate-env.sh` before `docker compose up` (`:71`).
  - New AC E2E-25, and E2E-02 now names generate-env.sh.
  - The E2E-01 check now also expects the generate-env line in `make -n e2e`.
  - New harness scenario: `BFF_CLIENT_SECRET=segredo-errado` (`scripts/e2e-smoke.test.sh:122-124`).

---

## Spec-Anchored Acceptance Criteria

Harness = `scripts/e2e-smoke.test.sh` at 245eaec; script under test = `scripts/e2e-smoke.sh`. ACs that were not touched keep their iteration-3 evidence; line numbers below are re-derived after the merge.

| ID | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------- | ----------------------- | ------ |
| E2E-01 *(changed)* | `make e2e` runs `scripts/e2e-smoke.sh` (and, per the E2E-25 Assumptions row, depends on `make env`) | `scripts/e2e-smoke.test.sh:55` - `[ "$(make_out -n e2e \| tail -1)" = "bash scripts/e2e-smoke.sh" ] && make_out -n e2e \| grep -q "sh scripts/generate-env.sh"` | ✅ PASS (MC, dropping `env` from `e2e:`, killed) |
| E2E-02 *(changed)* | runs `scripts/generate-env.sh` **and then** `docker compose up -d --build` without `E2E_SKIP_UP=1` | `scripts/e2e-smoke.test.sh:62` - `has "Subindo o ambiente (docker compose up -d --build)"` (banner at e2e-smoke.sh:69) | ✅ Covered by a declared limitation - spec.md Assumptions "How E2E-02 is verified" (`.specs/features/e2e-smoke/spec.md:44`): both calls are checked through the banner and by reading the code (e2e-smoke.sh:69-72). MB survives by design. |
| E2E-03 | no `docker compose up` with `E2E_SKIP_UP=1` | `scripts/e2e-smoke.test.sh:71` - `! has "Subindo o ambiente"` | ✅ PASS (proxy, unchanged) |
| E2E-04 | waits for the 5 apps to be healthy, at most `E2E_TIMEOUT` | `scripts/e2e-smoke.test.sh:63-64`; `:103` - `has "...apos 5s: order-service=exited"` | ✅ PASS |
| E2E-05 | admin token from Keycloak | `scripts/e2e-smoke.test.sh:64`; `:131` - `has "[FALHA] autenticacao: o Keycloak respondeu HTTP 000 sem access_token"` | ✅ PASS (realm user `admin` still present after the merge: `docker/keycloak/realms/omni-market-realm.json:51`) |
| E2E-06 | 401 without a token, checked by the script | `scripts/e2e-smoke.test.sh:110` - `has "[FALHA] autenticacao: importacao sem token respondeu HTTP 404, esperado 401"` | ✅ PASS |
| E2E-07 | `200` with `importedProducts` = 3 | `scripts/e2e-smoke.test.sh:152` - `has "[FALHA] importacao: HTTP 200: {\"importedProducts\":2}"`; `:138` | ✅ PASS |
| E2E-08 | A `APPROVED`, B and C `REJECTED` within 60 s | `scripts/e2e-smoke.test.sh:64`; `:95` | ✅ PASS |
| E2E-09 | stock 1 and one `reserved` message keyed by the order id | `scripts/e2e-smoke.test.sh:78`; `:120` - `has "...com a chave $order_id: esperado '1', ultimo valor '2'"` | ✅ PASS (topic still created: `docker/kafka/create-topics.sh:20`) |
| E2E-10 | stock back to 2 | `scripts/e2e-smoke.test.sh:78` | ✅ PASS (happy path only) |
| E2E-11 | one `[OK]` per step, exit 0 | `scripts/e2e-smoke.test.sh:78`, `:72` | ✅ PASS |
| E2E-12 | `[FALHA] <step>: <reason>`, exit 1, stop | `scripts/e2e-smoke.test.sh:94`, `:96` | ✅ PASS |
| E2E-13 | stack timeout lists the unhealthy services | `scripts/e2e-smoke.test.sh:103` | ✅ PASS |
| E2E-14 | async timeout prints the last value | `scripts/e2e-smoke.test.sh:95` | ✅ PASS |
| E2E-15 | per-run id in the SKUs | `scripts/e2e-smoke.test.sh:74` | ✅ PASS |
| E2E-16 | two runs exit 0 | `scripts/e2e-smoke.test.sh:72`, `:156` | ✅ PASS |
| E2E-17 | no deletion; volumes survive | `scripts/e2e-smoke.test.sh:159`, `:160-161` | ✅ PASS |
| E2E-18 | four `[PENDENTE]` lines | `scripts/e2e-smoke.test.sh:79-80` | ✅ PASS |
| E2E-19 | exit 0 with only pending steps | `scripts/e2e-smoke.test.sh:81` | ✅ PASS |
| E2E-20 | exit 1 with `E2E_STRICT=1` | `scripts/e2e-smoke.test.sh:86-87` | ✅ PASS |
| E2E-21 | summary at the end (success and failure) | `scripts/e2e-smoke.test.sh:82`, `:104` | ✅ PASS |
| E2E-22 | README documents `make e2e`, prerequisites, variables | inspection: `README.md:112`, `README.md:116`, `README.md:122-127` (now with `BFF_CLIENT_SECRET`) | ✅ PASS |
| E2E-23 | `e2e` in `make help` | `scripts/e2e-smoke.test.sh:56` | ✅ PASS |
| E2E-24 | `E2E_ORDER_ID` replaces the generated order id | `scripts/e2e-smoke.test.sh:117-120` | ✅ PASS |
| E2E-25 *(new)* | token requested with `BFF_CLIENT_SECRET`, read from `.env` when the variable is unset | `scripts/e2e-smoke.test.sh:124` - `[ "$code" = 1 ] && has "[FALHA] autenticacao: o Keycloak respondeu HTTP 401 sem access_token"` (the variable wins); every normal run (e.g. `:72`, `:156`) gets a token only through the `.env` fallback | ✅ PASS (MA, variable ignored, killed) |

**Status**: ✅ 25/25 ACs covered: 24 by discriminating assertions, 1 (E2E-02) by an owner-accepted declared limitation. 0 spec-precision gaps.

---

## Merge spot-checks

- **Topics**: `docker/kafka/create-topics.sh:20,24,29,30` still create `catalog.stock.reserved.v1`, `produto.analisado.v1`, `order.order.placed.v1` and `order.order.cancelled.v1`, and `kafka-topics --list` on the live broker shows all four.
- **Realm**:
  - Users `admin` and `customer` are still present (`omni-market-realm.json:41,51`), with new users added by dev.
  - The client secret is now `${BFF_CLIENT_SECRET}` (`:28`), injected by compose (`docker-compose.yaml:13,61`, `:?run make env`). This matches the script's fallback.
- **`.env`**: its SHA-1 was unchanged after the gate and after every sensor run. The worktree used an identical copy, and `docker compose --dry-run up -d` from the worktree showed no recreation.
- **Consumers on the merged stack** (logs, 15 min window covering the gate):
  - order-service has 0 error-level lines. It dead-letters the decoy `reserved` message and skips unknown order ids, which confirms the coordinator's check.
  - **New**: the script's own hand-published `order.order.cancelled.v1` events have no CloudEvents headers. billing-service dead-letters them (`WARN missing CloudEvents headers`), and marketplace-gateway rejects them (`level 40 UnprocessableMessageError`).
  - All 7 apps stay healthy. See O2.

---

## Edge Cases

- [x] Keycloak returns no token: `scripts/e2e-smoke.test.sh:127-131`. The wrong-secret run at `:124` adds the `HTTP 401` form.
- [x] The import answers something other than 200: `scripts/e2e-smoke.test.sh:134-138`.
- [x] Git Bash without `MSYS_NO_PATHCONV`: `scripts/e2e-smoke.sh` sets it only on the `docker exec` calls. The gate ran on Git Bash.
- [~] The spreadsheet cannot be created: not tested; the author accepted this. The code is correct by inspection.

---

## Gate Check

- **Gate command**: `bash scripts/e2e-smoke.test.sh` (real tree, merged stack, commit 245eaec)
- **Outcome**: 26 checks passed, 0 failed, 0 skipped; exit 0; 395 s. WireMock has 0 `e2e00000-*` stubs and `.env` is unchanged.
- **Test count**: 25 at iteration 3, 26 now (+1 E2E-25). The E2E-01 check got stricter. No checks were removed.

---

## Discrimination Sensor (post-merge)

Procedure:
- I used a temporary `git worktree` at 245eaec (`core.longpaths=true`) and copied in the real `.env` (byte-identical, checked with `cmp` after every run).
- `COMPOSE_FILE` and `COMPOSE_PROJECT_NAME` pointed at the real project.
- I mutated one file per mutant, ran the full worktree harness, and restored with `git checkout -- <file>`. No `git stash`.

Cleanup:
- Baseline porcelain (clean) matched after cleanup.
- The worktree is removed.
- The 7 apps are healthy and on `arquteitura-multiplataforma-trabalho-final_default`, and WireMock has 0 e2e stubs.

| Mutation | File:line | Description | Killed? |
| -------- | --------- | ----------- | ------- |
| MA | `scripts/e2e-smoke.sh:82` | `${BFF_CLIENT_SECRET:-...}` -> `${E2E_UNUSED_SECRET:-...}` (the variable no longer wins over `.env`) | ✅ Killed (E2E-25 check `:124`) |
| MB | `scripts/e2e-smoke.sh:71` | deleted `sh scripts/generate-env.sh ... \|\| fail ambiente ...` | ❌ Survived (0 failures, harness exit 0) |
| MC | `Makefile:120` | `e2e: env ##` -> `e2e: ##` | ✅ Killed (E2E-01 check `:55`) |

Why MB survives: with `.env` already complete, `generate-env.sh` changes nothing, so no scenario can see whether it ran. On a clean machine, `bash scripts/e2e-smoke.sh` run directly would then fail loudly at `docker compose up` (`:?run make env`); `make e2e` would still work through its `env` dependency. So this weakness cannot produce a false pass, only a loud failure on a clean machine.

Earlier mutants M1-M10 are unchanged and remain killed (iterations 1-3). None of their lines changed in the merge apart from line shifts.

**Sensor depth**: lightweight (3 targeted mutations on the post-merge code)
**Outcome**: 2/3 killed; MB accepted under the declared E2E-02 limitation (5e5da82). Not blocking.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ - 245eaec is +20/-6 lines; reuses dev's `generate-env.sh` instead of duplicating secret handling |
| Surgical changes | ✅ - the merge resolution keeps dev's Makefile/README and adds only the e2e pieces |
| No scope creep | ✅ |
| Matches patterns | ✅ - follows ADR-0003 (secrets from `.env`, never hard-coded); `make env` convention |
| Spec-anchored outcome check | ✅ - every AC is asserted on its spec value, except E2E-02, which the spec now declares verified by banner and inspection |
| Every test maps to a spec requirement | ✅ - 26 checks, all tagged |
| Documented guidelines followed: root `CLAUDE.md` | ✅ |

---

## Owner Decision (option B, commit 5e5da82)

The Verifier's judgment of the new spec rows:

- **"How E2E-02 is verified"** (`.specs/features/e2e-smoke/spec.md:44`). I accept it as a declared limitation, the same treatment as the spreadsheet edge case. Its facts match what I verified:
  - On a running stack with a complete `.env`, both calls change nothing, so no scenario can observe them (that is why MB survives).
  - The compose file refuses to start without the secrets (`docker-compose.yaml:13,61`, `:?run make env`).
  - `make e2e` runs `make env` first (Makefile:120, MC killed).
  - The alternative would edit the developer's secret-bearing `.env`.
- **Nuance, non-blocking**: the "cannot produce a false pass" argument fully covers `generate-env.sh`. For the `docker compose up -d --build` half, a deleted call on an already running stack would test the images that are up, which may be stale relative to the source. That is the same situation as a deliberate `E2E_SKIP_UP=1` run, and iteration 3 already accepted this half as banner-only (O2), so I do not reopen it.
- **Prerequisites row**: now names `sh` and `openssl` for generating `.env` (`.specs/features/e2e-smoke/spec.md`, Prerequisites row). `README.md:116` says the same. This closes the former O4.

## Ranked Observations

1. **O1 (closed by owner decision)** - MB survives by design under the declared E2E-02 limitation (`scripts/e2e-smoke.sh:71`; spec.md:44).
2. **O2 (Medium, follow-up PR)** - the plan-B events published by the script (`scripts/e2e-smoke.sh` `publish`) carry no CloudEvents headers. On the merged stack, billing-service dead-letters every `order.order.cancelled.v1` from the test and marketplace-gateway rejects it. Catalog still processes them, so v1 passes. The follow-up PR, which automates orders through the real order-service, should replace the hand-published events or add the `ce_*` headers. The decoy `reserved` message (iteration-3 O1) is now confirmed harmless: order-service dead-letters it and stays healthy.
3. **O3 (Minor)** - E2E-03 and E2E-04 remain proxied or partial (banner; only order-service is faulted).
4. **O4 (closed in 5e5da82)** - the README said the test needs only `bash`, `curl` and Docker (`README.md:116`), but `make env` / `generate-env.sh` on a machine without `.env` also needs `sh` and `openssl` (`openssl rand`). Git Bash and most Linux/macOS hosts have both.
5. **O5 (Info)** - every run leaves test products and messages, plus dead-letter entries in billing, order and marketplace, in the local stack.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| ----------- | --------------- | ---------- |
| E2E-01, E2E-25 | Implementing | ✅ Verified |
| E2E-02 | Implementing | ✅ Verified (declared limitation, spec.md:44) |
| E2E-03..E2E-24 | Verified | ✅ Verified (re-checked after the merge) |

(The Verifier did not edit spec.md.)

---

## Summary

**Overall**: ✅ Ready for the v1 PR (Refs #37)

**Spec-anchored check**: 25/25 ACs covered (24 discriminating, 1 declared limitation accepted by the owner), 0 spec-precision gaps
**Sensor**: 2/3 post-merge mutations killed. MB is accepted under the E2E-02 declared limitation. M1-M10 from iterations 1-3 remain killed.
**Gate**: 26 passed, 0 failed (245eaec; 5e5da82 changes only docs)

**What works**:
- The full v1 flow on the merged, Vault-enabled stack.
- The client secret follows ADR-0003, with the variable winning over `.env`.
- `make e2e` depends on `make env`.
- Every earlier AC is still green after the merge.

**Follow-up for the next PR (dev merge + automation of listing, order, confirmation, billing)**: O2 - the hand-published `order.order.cancelled.v1` events carry no CloudEvents headers, so billing-service dead-letters them and marketplace-gateway rejects them. Replace them with real order-service events, or add the `ce_*` headers.
