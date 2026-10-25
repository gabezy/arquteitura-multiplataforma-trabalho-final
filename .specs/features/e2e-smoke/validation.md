# e2e-smoke Validation (v2: full flow, iteration 3 of 3)

**Date**: 2026-10-25
**Spec**: `.specs/features/e2e-smoke/spec.md` v2 (30 active ACs, 6 retired IDs: E2E-09, -10, -18, -19, -20, -24; 5 edge cases)
**Diff range**: `3de0d1b..8fbc20c`. v2 is acdff0f plus fix commits d1e8c3f (run ids), 97c3e99 (harness: run ids as text) and 8fbc20c (token retries counted from the output instead of timed).
**Verifier**: independent sub-agent (author ≠ verifier)
**Result**: PASS - 30/30 ACs covered (26 discriminating, 4 accepted declared limitations), gate 30/30 on 8fbc20c (coordinator's full run). Fix 1 is confirmed: the token-retry check now counts the 4 retry lines and passes on unmodified code when its scenario runs alone. N7 is killed. Two surviving Assumptions-level mutants (N9, N10) are non-blocking.

---

## v2 iterations

| Iter. | Commit | Gate | Sensor | Verdict | Gaps |
| ----- | ------ | ---- | ------ | ------- | ---- |
| v2-1 | acdff0f | 29/29 (856 s) | 6/8 killed (N1 equivalent, N7 not tied to an AC) | FAIL | E2E-15 run ids (single-digit `$RANDOM` gives an empty slice; `printf %d` reads a leading 0 as octal) |
| v2-2 | 97c3e99 | 30/30 (887 s, Verifier's own run; the coordinator also reported 30/30) | N7 killed; run-id padding mutant (P1) killed by a bash check | FAIL | the retry timing check fails on unmodified code outside the full sequence (Fix 1) |
| v2-3 | 8fbc20c | 30/30 (coordinator's full run; only the retry loop and its check changed) | control passes alone; N7 killed; N9, N10 survive (Assumptions-level, non-blocking) | PASS | none blocking |

### Iteration-3 check of Fix 1 (8fbc20c)

- **Script**: confirmed by reading `scripts/e2e-smoke.sh:122-130`. The loop breaks on a token, on a status other than 000, or at `attempt = 5`. Otherwise it prints `autenticacao: tentativa $attempt de 5 sem resposta do Keycloak` and sleeps 2 s, so 5 attempts print 4 lines.
- **Harness**: `scripts/e2e-smoke.test.sh:125-126` asserts exactly 4 lines matching `^autenticacao: tentativa [1-4] de 5 sem resposta do Keycloak$`, and the timing check is gone.
- **Spec**: the Timeouts row names the message.
- **Control** (unmodified code, Keycloak scenario alone): `retry_lines=4`, `[FALHA] autenticacao: o Keycloak respondeu HTTP 000 sem access_token`, both checks ok, 39 s. In iteration 2 the timing check had failed 3/3 in this same setup.

### Iteration-2 checks of the fixes

- **d1e8c3f (E2E-15)** is fixed, confirmed by reading the code and by a bash check of the script's own lines:
  - `RUN="$(date +%s)$(printf '%05d' "$RANDOM")"` is at `scripts/e2e-smoke.sh:23`. The order and stub ids at `:31-34` use `${RUN: -12}` as text.
  - I evaluated these lines with a fake `date` (epochs 1792942364 and 1800012345) and `$RANDOM` = 0, 7, 31234. `RUN` was always 15 characters, the slice always 12 digits, and leading zeros were kept as text (e.g. stub `...-001234500000`, order `1001234500000`).
- **97c3e99**:
  - `run_stubs_left` (`scripts/e2e-smoke.test.sh:44`) builds the id as text, matching the script.
  - The Keycloak scenario now times the run and checks `[ "$elapsed" -ge 40 ]` (`:120-127` at 97c3e99; replaced in 8fbc20c).

---

## Spec-Anchored Acceptance Criteria (v2)

Harness = `scripts/e2e-smoke.test.sh`; script = `scripts/e2e-smoke.sh` (both at 97c3e99).

| ID | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------- | ----------------------- | ------ |
| E2E-01 | `make e2e` runs the script (after `make env`) | `scripts/e2e-smoke.test.sh:65-66` | ✅ PASS |
| E2E-02 | generate-env.sh, then `docker compose up -d --build` | `scripts/e2e-smoke.test.sh:73` (banner); spec Assumptions "How E2E-02 is verified" | ✅ Declared limitation (owner, v1) |
| E2E-03 | no up with `E2E_SKIP_UP=1` | `scripts/e2e-smoke.test.sh:84` | ✅ PASS (proxy) |
| E2E-04 | wait for the 7 apps healthy | `scripts/e2e-smoke.test.sh:74-75`; `:103-104` - `order-service=exited`; APPS at `scripts/e2e-smoke.sh:21` | ✅ PASS (only order-service is faulted) |
| E2E-05 | admin token | `scripts/e2e-smoke.test.sh:75`; `:122-123` - `HTTP 000 sem access_token` | ✅ PASS |
| E2E-06 | 401 without a token, checked by the script | `scripts/e2e-smoke.test.sh:110-111` | ✅ PASS |
| E2E-07 | `200` with `importedProducts` = 4 | `scripts/e2e-smoke.test.sh:145-146` - `HTTP 200: {"importedProducts":3}` fails | ✅ PASS |
| E2E-08 | A, D `APPROVED`; B, C `REJECTED` | `scripts/e2e-smoke.test.sh:75` (`scripts/e2e-smoke.sh:145-148`); `:96` | ✅ PASS |
| E2E-11 | nine `[OK]` in order, exit 0 | `scripts/e2e-smoke.test.sh:74-75` | ✅ PASS |
| E2E-12 | `[FALHA]`, exit 1, stop | `scripts/e2e-smoke.test.sh:94-95`, `:97` | ✅ PASS |
| E2E-13 | stack timeout lists services | `scripts/e2e-smoke.test.sh:103-104` | ✅ PASS |
| E2E-14 | timeout prints the last value | `scripts/e2e-smoke.test.sh:96` and every fault check (`ultimo valor '<x>'`) | ✅ PASS |
| E2E-15 | SKUs and simulated order ids carry a run id that differs on every run | `scripts/e2e-smoke.test.sh:87-88` - `[ "$first_run" != "$second_run" ]`; fixed code `scripts/e2e-smoke.sh:23,31-34`, verified by a bash check for short `$RANDOM` and leading-zero slices | ✅ PASS (fixed in d1e8c3f) |
| E2E-16 | two runs exit 0 | `scripts/e2e-smoke.test.sh:75`, `:85`, `:202` | ✅ PASS |
| E2E-17 | no deletion; volumes survive | `scripts/e2e-smoke.test.sh:205`, `:206-207` | ✅ PASS |
| E2E-21 | summary `Resumo: N ok, M falha(s)` | `scripts/e2e-smoke.test.sh:76`, `:105` | ✅ PASS |
| E2E-22 | README: `make e2e`, prerequisites, 5 variables | inspection: `README.md:112`, `README.md:127`, `README.md:132-136` | ✅ PASS |
| E2E-23 | `e2e` in `make help` | `scripts/e2e-smoke.test.sh:67` | ✅ PASS |
| E2E-25 | secret from `BFF_CLIENT_SECRET`, else `.env` | `scripts/e2e-smoke.test.sh:115-116` | ✅ PASS |
| E2E-26 | 3 listings `PUBLISHED` | `scripts/e2e-smoke.test.sh:195-196` - `esperado '3', ultimo valor '2'` | ✅ PASS (N8 killed) |
| E2E-27 | order with that `externalOrderId` | `scripts/e2e-smoke.test.sh:152-153` - `[FALHA] pedido ... ultimo valor ''` | ✅ PASS (N1 equivalent/stricter) |
| E2E-28 | order `CONFIRMED` or `PAID` | `scripts/e2e-smoke.test.sh:159-160` - `ultimo valor 'CANCELLED'` | ✅ PASS (N2 killed) |
| E2E-29 | stock of A = 1 | `scripts/e2e-smoke.test.sh:164-165` - `ultimo valor '0'` | ✅ PASS (N3 killed) |
| E2E-30 | invoice `PAID` | `scripts/e2e-smoke.test.sh:172-173` - `ultimo valor 'PAYMENT_FAILED'` | ✅ PASS (N4 killed) |
| E2E-31 | order `PAID` | `scripts/e2e-smoke.test.sh:75` (`scripts/e2e-smoke.sh:165`); Assumptions "Later checks of one step" | ✅ Declared limitation |
| E2E-32 | refused invoice `PAYMENT_FAILED` | `scripts/e2e-smoke.test.sh:188-189` - `ultimo valor 'PAID'` | ✅ PASS (N5 killed) |
| E2E-33 | order `CANCELLED/PAYMENT_FAILED` | `scripts/e2e-smoke.test.sh:75` (`scripts/e2e-smoke.sh:174`); declared limitation | ✅ Declared limitation |
| E2E-34 | stock of D back to 2 | `scripts/e2e-smoke.test.sh:75` (`scripts/e2e-smoke.sh:175`); declared limitation | ✅ Declared limitation |
| E2E-35 | stubs removed when the run ends | `scripts/e2e-smoke.test.sh:77`, `:154` | ✅ PASS (N6 killed) |
| E2E-36 | `E2E_ORDER_QUANTITY` sets the units | `scripts/e2e-smoke.test.sh:159-160`, `:164-165` | ✅ PASS |

**Status**: ✅ 30/30 ACs covered: 26 by discriminating assertions, 4 by accepted declared limitations (E2E-02, -31, -33, -34). 0 spec-precision gaps. The remaining gap is in the reliability of the harness check for an Assumptions-level behavior (the token retry), not in an AC.

### Declared limitations - judgment (unchanged)

- **"Later checks of one step" (E2E-31, -33, -34)**: accepted. The first check of each step has a deterministic fault, and a fault for the later checks would need a service edit or a timing-dependent network cut. The later checks still assert spec values in the happy path.
- **"How E2E-02 is verified"**: accepted (v1 owner decision).

---

## Edge Cases

- [x] Keycloak gives no token: `scripts/e2e-smoke.test.sh:119-126`.
- [x] Import does not answer 200: `scripts/e2e-smoke.test.sh:129-133`.
- [x] Git Bash without `MSYS_NO_PATHCONV`: no `docker exec` left in the script; the gate ran on Git Bash.
- [x] Order quantity above the stock fails confirmacao with the last status: `scripts/e2e-smoke.test.sh:158-160`.
- [~] Spreadsheet cannot be created: not tested, accepted in v1; correct by inspection (`scripts/e2e-smoke.sh:136-138`).

---

## Gate Check

- **Gate command**: `bash scripts/e2e-smoke.test.sh` (real tree, 97c3e99). I re-ran it because my isolated control runs of the new retry check failed.
- **Outcome**: 30 passed, 0 failed, 0 skipped; exit 0; 887 s. Afterwards WireMock had 0 `e2e000*` stubs, the 3 `-mode` scenarios were `Started`, the 7 apps were healthy, and `.env` was unchanged.
- **Test count**: 29 -> 30 (+1 retry check).
- **v2-3 (8fbc20c)**: the coordinator ran the full real-tree gate: 30/30, exit 0. 8fbc20c changes only the retry loop (+1 echo line), its harness check and the spec Timeouts row. My own control run of that scenario on unmodified code passed, and afterwards the 7 apps were healthy, WireMock had 0 e2e stubs, the 3 `-mode` scenarios were `Started` and `.env` was unchanged.

---

## Discrimination Sensor (v2, cumulative)

Same procedure as v2-1:
- A temporary worktree with a copy of `.env` and `COMPOSE_FILE`/`COMPOSE_PROJECT_NAME` pointing at the real project; no `git stash`.
- Mutants were run against the matching harness scenario(s) only, copied verbatim from test.sh (prelude lines 1-52 including the `restore` trap).
- The worktree is removed and porcelain matches the baseline.

| Mutation | File:line (97c3e99) | Description | How run | Killed? |
| -------- | ------------------- | ----------- | ------- | ------- |
| N1 (v2-1) | `scripts/e2e-smoke.sh:74` | order lookup ignores `externalOrderId` | happy + order-service isolation | ❌ Survived - equivalent/stricter (`/orders` newest-first, `order-service/src/infra/persistence/knex-order.repository.ts:104`). Non-blocking. |
| N2-N6, N8 (v2-1) | `scripts/e2e-smoke.sh:159`, `:160`, `:164`, `:173`, `:38`, `:70` | CONFIRMED\|PAID widened; stock check deleted; invoice expectations widened; stub DELETE removed; listing counts any status | matching scenarios | ✅ Killed (all 6) |
| N7 (re-run) | `scripts/e2e-smoke.sh:127` | `[ "$status" != 000 ]` -> `= 000` (no retry on 000) | Keycloak isolation scenario (`test.sh:119-127`) | ✅ Killed - `elapsed=13`, retry check FAIL |
| P1 (new) | `scripts/e2e-smoke.sh:23` | drop the padding: `$(printf '%05d' "$RANDOM")` -> `$RANDOM` | bash check of the script's own run-id lines (fake `date`, `$RANDOM` = 0, 7, 31234) | ✅ Killed by the bash check: with `$RANDOM` = 0 or 7 the mutant gives `len=11`, order ids `1`/`2` and stub `...-8000-` (empty); the fixed code always gives 15/12 digits. The harness cannot catch it, since it occurs in about 0.03% of runs. |
| Control (v2-2) | `scripts/e2e-smoke.sh` unmodified at 97c3e99 | Keycloak isolation scenario alone | 3 runs | ⚠️ The old timing check failed on unmodified code (32, 37, 37 s against 40) - fixed in 8fbc20c |
| Control (v2-3) | unmodified at 8fbc20c | Keycloak isolation scenario alone | 1 run | ✅ Both checks pass: 4 retry lines, `HTTP 000` |
| N7 (v2-3) | `scripts/e2e-smoke.sh:127` | `[ "$status" != 000 ]` -> `= 000` | Keycloak isolation scenario alone | ✅ Killed - 0 retry lines, count check FAIL |
| N9 (v2-3) | `scripts/e2e-smoke.sh:127` | drop `\|\| [ "$attempt" = 5 ]` (an extra "tentativa 5 de 5" line and 2 s, still 5 attempts) | Keycloak isolation scenario alone | ❌ Survived - cosmetic, behavior unchanged (still 5 attempts). Non-blocking. |
| N10 (v2-3) | `scripts/e2e-smoke.sh:122` | `for attempt in 1 2 3 4 5` -> `1 2 3 4` (only 4 attempts) | Keycloak isolation scenario alone | ❌ Survived - 4 attempts print the same 4 lines as 5 attempts. Off-by-one in an Assumptions-level retry count, not an AC. Non-blocking (O1). |

Why the control fails: I timed the token request directly with Keycloak cut off the network on Docker Desktop. The first attempt timed out at 10.2 s, and the next attempts got `Empty reply from server` in 3.1-5.1 s. Five attempts plus four 2 s sleeps therefore take about 33-37 s, not the 56 s the commit assumes. Inside the full gate the check passed (elapsed not printed), so the outcome depends on the scenario order and on how the host's port proxy behaves. On Linux Docker, where a disconnected container's published port is normally refused at once, the original code would take about 8 s (the sleeps) and fail every time. I did not run this; it is by reasoning.

**Sensor depth**: expanded
**Outcome**: every AC-level mutant is killed. The survivors are N1 (equivalent/stricter), N9 (cosmetic) and N10 (retry count off by one, Assumptions-level). None of them blocks.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ - d1e8c3f: one `printf '%05d'` and two text slices |
| Surgical changes | ✅ - script and harness only |
| No scope creep | ✅ |
| Matches patterns | ✅ |
| Spec-anchored outcome check | ✅ - every AC asserted on its spec value or covered by a declared limitation |
| Harness reliability | ✅ - the retry check counts output lines (8fbc20c) and passes alone and in the full gate |
| Every test maps to a spec requirement | ✅ - the retry check is tagged "Assumptions: Timeouts" |
| Documented guidelines followed: root `CLAUDE.md` | ✅ |

---

## Fix Plans

No blocking fixes. Fix 1 (timing-based retry check) was applied in 8fbc20c and is confirmed above.

Optional hardening for O1: print the attempt line on every attempt that gets no answer, including the 5th, and assert 5 lines. That would kill N10, and N9 would become moot.

---

## Ranked Observations

1. **O1 (Minor, non-blocking)** - the retry count is not fully pinned: N10 (4 attempts instead of 5) prints the same 4 lines (`scripts/e2e-smoke.sh:122-130`, `scripts/e2e-smoke.test.sh:125-126`). The retry is an Assumptions (Timeouts) detail, not an AC; see the optional hardening.
2. **O2 (Minor)** - E2E-04: only order-service is faulted among the 7 apps.
3. **O3 (Info)** - N1: the `externalOrderId` filter is defensive only on this single-client stack.
4. **O4 (Info)** - each run leaves products, orders, invoices and listings in the local stack, as the spec allows.

---

## Requirement Traceability Update

| Requirement | New Status |
| ----------- | ---------- |
| E2E-01, -03..-08, -11..-17, -21..-23, -25..-30, -32, -35, -36 | ✅ Verified |
| E2E-02, -31, -33, -34 | ✅ Verified (declared limitation) |
| E2E-09, -10, -18, -19, -20, -24 | Retired (v2) |

All 30 active ACs are verified. (The Verifier did not edit spec.md.)

---

## Earlier history (v1, 24-25 ACs)

| Pass | Commit | Gate | Sensor | Verdict | Notes |
| ---- | ------ | ---- | ------ | ------- | ----- |
| 1 | 187c4fa | 21/21 | 3/5 killed | FAIL | M1 (401 check) and M2 (`reserved` message) survived |
| 2 | 3d835d1 | 24/24 | 4/5 killed | FAIL | M7 (`importedProducts` count) survived |
| 3 | dce20ab | 25/25 | 3/3 killed | PASS | - |
| post-merge | 245eaec | 26/26 | 2/3 killed | FAIL | MB (generate-env call) survived |
| post-merge, owner decision | 5e5da82 | 26/26 | MB accepted | PASS | E2E-02 declared limitation |

---

## Summary

**Overall**: ✅ Ready - v2 closes #37

**Spec-anchored check**: 30/30 ACs covered (26 discriminating, 4 accepted declared limitations), 0 spec-precision gaps
**Sensor**: every AC-level mutant is killed (N2-N8; P1 by bash check). The survivors are non-blocking: N1 (equivalent/stricter), N9 (cosmetic), N10 (retry count off by one, Assumptions-level).
**Gate**: 30 passed, 0 failed (8fbc20c, coordinator's full run; the Verifier's own full run on 97c3e99 was also 30/30). The retry check passes alone on unmodified code.

**What works**:
- The full flow through public interfaces: listing, a Mercado Livre order through the simulator, confirmation and stock, invoice and order paid, and the refused payment with cancellation and stock returned.
- Every first check of a step has a deterministic fault.
- Run ids are fixed-width.
- Token retries are counted deterministically.
- Stubs and scenario states are restored after every run.

**Next steps**: merge the v1+v2 PR (closes #37). Optionally apply the O1 hardening.
