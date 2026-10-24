# New services infra Validation

**Date**: 2026-10-24 (iteration 3, final)
**Spec**: `.specs/features/new-services-infra/spec.md`
**Diff range**: `0731899..c4ecd6b` (branch `feature/14-infra-servicos-novos`, rebased onto `origin/dev` = `0731899`, 12 commits; PR #83 head = `c4ecd6b`)
**Verifier**: independent sub-agent (author ≠ verifier), re-verification iteration 3 of 3

**Result: PASS ✅**

All 22 ACs (PLAT-01..22) are met. The four gaps from iteration 1 and the two minor gaps from iteration 2 are resolved, and so is the cosmetic note. The sensor killed all 7 re-run mutants (11/11 in iteration 2). The Static, Topics diff, C4 and Smoke gates pass when run exactly as written in tasks.md. Every `make <target>` that a doc or gate tells the reader to run exists (`make -n` → rc 0). The old target names `make up-infra` / `make topics` are left only in three places: the rebase note (`tasks.md:17`), the evidence recorded before the rebase (`tasks.md:165`, `:166`, `:199`, `:202`) and the spec's deviation row (`spec.md:63`, which says the issue used the old names).

---

## Iteration history

### Iteration 1: FAIL, 4 gaps

| # | Gap | Resolution | Re-confirmed in iteration 3 |
| --- | --- | --- | --- |
| 1 | 351 MB Oracle JDK committed (`oracleJdk-27/lib/modules` 146 MB > 100 MB) | Branch rewritten and rebased; the JDK commit is gone | `git rev-list --objects 0731899..HEAD \| git cat-file --batch-check` → 0 blobs > 100 MB; largest blob is the container PNG (1,618,603 B). `oraclejdk` matches 0 entries in the range objects and 0 paths in `git ls-tree -r HEAD` ✅ |
| 2 | Container PNG not re-exported (PLAT-22) | `f2de875` re-exports it (3674 × 3151 px) | Not changed since iteration 2 (`git diff --stat f2de875 c4ecd6b` touches only `tasks.md` and `docs/eventos.md`); iteration 2's visual check carries over ✅ |
| 3 | Weak gates: M11 and M13 survived | Stronger eventos gate and C4 gate (`tasks.md:47-66`) | Re-ran M11 and M13 plus 5 more: all killed (see sensor) ✅ |
| 4 | PLAT-05 evidence not isolated | `tasks.md:167` records the isolated check | Carried over from iteration 2 (2026-10-24); `docker-compose.yaml:118` unchanged ✅ |

### Iteration 2: FAIL (minor), 2 gaps + 1 cosmetic note

| # | Gap | Resolution | Re-check (this run) | Status |
| --- | --- | --- | --- | --- |
| A | `docs/eventos.md:619` said `make topics` (target renamed to `compose-topics` on `dev`) | `c4ecd6b` | `docs/eventos.md:619` now says `` (`make compose-topics`) ``; `grep -n 'make topics' docs/eventos.md` → nothing; `make -n compose-topics` → rc 0; eventos gate → `OK` | ✅ Resolved |
| B | `tasks.md:27`, `:28`, `:43` (matrix and Smoke gate) used `make up-infra` / `make topics` | `c4ecd6b` (also the task text at `:137`, `:151`, `:152`, `:176`, `:191`) | `tasks.md:27` / `:43` → `make compose-up-infra`; `tasks.md:28` / `:43` → `make compose-topics`. I ran each target named by `README.md`, `CLAUDE.md`, `docs/eventos.md`, both spec copies and `tasks.md` through `make -n <target>`. The ones they tell the reader to run all return rc 0: `compose-up`, `compose-up-infra`, `compose-topics`, `compose-ps`, `compose-clean`, `compose-down`, `compose-logs`, `compose-restart`, `compose-vault`, `env`, `act-*`, `k8s-*`. The old `up`, `up-infra` and `topics` return rc 2 and are left only in `tasks.md:17` (rebase note), `tasks.md:165`, `:166`, `:199`, `:202` (pre-rebase evidence) and `spec.md:63` (deviation row) | ✅ Resolved |
| cosmetic | T6 evidence cited `README.md:61-63` | `c4ecd6b` | `tasks.md:319` now cites `README.md:176`, `:177` and `:178`, which hold the `order-db`, `billing-db` and `marketplace-db` rows | ✅ Resolved |

---

## Diff surface

`git diff --stat 0731899..HEAD`: **6 files changed, 782 insertions(+), 28 deletions(-)**. The last commit `c4ecd6b` changes 2 files (10 insertions, 10 deletions) and only text.

| Path | Change | Expected? |
| --- | --- | --- |
| `docs/eventos.md` | stale pending list replaced by one paragraph (`docs/eventos.md:617-619`), now naming `make compose-topics` | yes |
| `docs/c4/Omni Market - C4 Model Contexto.drawio` | 4 attributes (lines 137, 147, 192, 197) | yes |
| `docs/c4/Omni Market - C4 Model Contexto-C4 - Container.drawio.png` | re-exported | yes |
| `.specs/features/new-services-infra/spec.md`, `tasks.md` | new | yes |
| `docs/specs/plataforma/infra-servicos-novos/spec.md` | spec copy; `diff` with the source prints nothing (`SAME`) | yes |

No infra file (`docker-compose.yaml`, `Makefile`, `create-topics.sh`, workflows, `README.md`, `CLAUDE.md`) changed in the range.

Commits: `3e21d1f`, `8295a0d`, `753a44b`, `6b92efb`, `f61c618`, `0d8d31d`, `314a1f7`, `8b9c8fe`, `f64df51`, `3999314`, `f2de875`, `c4ecd6b`. All are Conventional Commits in Portuguese.

---

## Task Completion

| Task | Status | Notes |
| --- | --- | --- |
| T1 | ✅ Done | `docs/eventos.md:619` fixed in `c4ecd6b` |
| T2 | ✅ Done | - |
| T3 | ✅ Done | - |
| T4 | ✅ Done | - |
| T5 | ✅ Done | - |
| T6 | ✅ Done | evidence now cites `README.md:176-178` |
| T7 | ✅ Done | - |

---

## Spec-Anchored Acceptance Criteria

"Re-confirmed (iter 3)" means I re-ran the check or re-read the cited line at HEAD `c4ecd6b` on 2026-10-24 (~18:40–18:46 UTC). "Carried over (iter 2, 2026-10-24)" means the evidence comes from iteration 2. Iteration 3 did not re-run those checks, because `f2de875..c4ecd6b` touches none of the files they read.

| ID | Spec-defined outcome | Evidence (`file:line` + command/output) | Source | Result |
| --- | --- | --- | --- | --- |
| PLAT-01 | `order-db` 5434, `billing-db` 5435, `marketplace-db` 5436, `postgres:18-alpine` | `docker-compose.yaml:113` `image: postgres:18-alpine` (order-db), `:149` (billing-db), `:131` (marketplace-db); ports `:120`, `:156`, `:138`. Config JSON → `5434:5432`, `5435:5432`, `5436:5432` | Lines re-read (iter 3); config JSON carried over (iter 2) | ✅ PASS |
| PLAT-02 | `healthy` ×3 within 60 s | healthchecks `docker-compose.yaml:123-128`, `:141-146`, `:159-164`. `docker inspect -f '{{.Name}} {{.State.Health.Status}}' order-db billing-db marketplace-db` at 18:44:29 UTC → `/order-db healthy`, `/billing-db healthy`, `/marketplace-db healthy`. Time to healthy (< 60 s) comes from the author's 17:12:08 reading | Re-confirmed (iter 3) | ✅ PASS |
| PLAT-03 | `<db>-data:/var/lib/postgresql` | `docker-compose.yaml:122` `- order-db-data:/var/lib/postgresql`, `:158`, `:140`; top-level volumes `:441-443` | Re-read (iter 3) | ✅ PASS |
| PLAT-04 | `make compose-up-infra` starts the DBs, not the 3 apps | `Makefile:3` (`APPS := bff-gateway catalog-service compliance-service order-service billing-service marketplace-gateway`), `Makefile:24-25` (`up -d $(foreach app,$(APPS),--scale $(app)=0)`); `make -n compose-up-infra` → rc 0. `--dry-run` check: the 3 apps would be stopped, none started | Makefile re-read (iter 3); dry-run carried over (iter 2) | ✅ PASS |
| PLAT-05 | missing key → error containing `run make env` | `docker-compose.yaml:118` `POSTGRES_PASSWORD: ${ORDER_DB_PASSWORD:?run make env}`. Isolated check: exit 1, `required variable ORDER_DB_PASSWORD is missing a value: run make env`; control exit 0 | Line re-read (iter 3); run carried over (iter 2) | ✅ PASS |
| PLAT-06 | 9 event topics, 3 partitions | `docker/kafka/create-topics.sh:29-31`, `:37-39`, `:47-49`. `kafka-topics.sh --describe` after this run's `make compose-topics` → `PartitionCount: 3` for `order.order.{placed,cancelled,confirmed}.v1`, `marketplace.order.received.v1`, `marketplace.listing.{published,failed}.v1`, `billing.invoice.issued.v1`, `billing.payment.{confirmed,failed}.v1` | Re-confirmed (iter 3) | ✅ PASS |
| PLAT-07 | 6 DLQs, 1 partition, `retention.ms=1209600000` | `docker/kafka/create-topics.sh:32-34`, `:40-41`, `:50`. `--describe` → `PartitionCount: 1 retention.ms=1209600000` for `order.{marketplace-order,stock-response,billing-payment}.dlq`, `marketplace.{catalog-product,order-cancelled}.dlq`, `billing.order-events.dlq` | Re-confirmed (iter 3) | ✅ PASS |
| PLAT-08 | rerun exits 0, partitions unchanged | `docker/kafka/create-topics.sh:11` (`--if-not-exists`). `make compose-topics` → make rc 0; `kafka-init status=exited exit=0 finished=2026-10-24T18:45:09Z`; 0 `error`/`exception` lines in its log; the 15 topics keep the partition counts above, the same as iteration 2 | Re-confirmed (iter 3) | ✅ PASS |
| PLAT-09 | eventos.md lists no created topic as pending | `docs/eventos.md:617` `## Tópicos no \`create-topics.sh\``, `:619` points to the script (`make compose-topics`). Eventos gate (`tasks.md:50-53`, verbatim) → `OK`. Cross-check doc vs script carried over: script-only names = none | Gate re-run (iter 3); cross-check carried over (iter 2) | ✅ PASS |
| PLAT-10 | order/marketplace → `_node-service.yml`, billing → `_go-service.yml` | `.github/workflows/order-service.yml:27` and `.github/workflows/marketplace-gateway.yml:44` `uses: ./.github/workflows/_node-service.yml`; `.github/workflows/billing-service.yml:27` `uses: ./.github/workflows/_go-service.yml` | Re-read (iter 3) | ✅ PASS |
| PLAT-11 | order-only push → only `order-service` | filter `.github/workflows/order-service.yml:11-13`. `62d1d8c4` (only `order-service/`) → push runs `[order-service:success]` | Carried over (iter 2, 2026-10-24) | ✅ PASS |
| PLAT-12 | billing-only push → only `billing-service` | filter `.github/workflows/billing-service.yml:11-13`. `6be4e60a` → `[billing-service:success]` | Carried over (iter 2) | ✅ PASS |
| PLAT-13 | marketplace-only push → only `marketplace-gateway` | filter `.github/workflows/marketplace-gateway.yml:10-21`. `b171a982`, `7e662302` → `[marketplace-gateway:success]` each | Carried over (iter 2) | ✅ PASS |
| PLAT-14 | `_node-service.yml`-only push → catalog, order, marketplace | `.github/workflows/catalog-service.yml:13`, `.github/workflows/order-service.yml:13`, `.github/workflows/marketplace-gateway.yml:21` list `_node-service.yml`, and no other workflow does. No such push exists, and T5 allows the static check as evidence | Carried over (iter 2) | ✅ PASS (static) |
| PLAT-15 | 8084/8086/8087 → order/billing/marketplace | `docker-compose.yaml:355` `"8084:8084"`, `:378` `"8086:8086"`, `:400` `"8087:8087"`; owner map `8084 [order-service]`, `8086 [billing-service]`, `8087 [marketplace-gateway]` | Lines re-read (iter 3); owner map carried over (iter 2) | ✅ PASS |
| PLAT-16 | 8085 only Keycloak | `docker-compose.yaml:15` `"8085:8080"`; owner map `8085 [keycloak]` | Line re-read (iter 3); owner map carried over (iter 2) | ✅ PASS |
| PLAT-17 | README services table ports | `README.md:24` order-service `8084`, `README.md:25` billing-service `8086`, `README.md:26` marketplace-gateway `8087` | Re-read (iter 3) | ✅ PASS |
| PLAT-18 | README components table DBs + user + password source | `README.md:176` `order-db` `localhost:5434` `orders` / `ORDER_DB_PASSWORD` do `.env`; `README.md:177` `billing-db` `localhost:5435` `billing` / `billing`; `README.md:178` `marketplace-db` `localhost:5436` `marketplace` / `marketplace` | Re-read (iter 3) | ✅ PASS |
| PLAT-19 | billing-service `Go 1.27, net/http` | `docs/c4/Omni Market - C4 Model Contexto.drawio:147` `c4Technology="Go 1.27, net/http"`; C4 gate `OK`; PNG label `[Container: Go 1.27, net/http]` | `.drawio` re-confirmed (iter 3); PNG carried over (iter 2) | ✅ PASS |
| PLAT-20 | marketplace-gateway `Node.js 22, TypeScript, Express 5` | `…drawio:137` `c4Technology="Node.js 22, TypeScript, Express 5"`; C4 gate `OK`; PNG label present | Same | ✅ PASS |
| PLAT-21 | billing-db / marketplace-db descriptions | `…drawio:192` `Faturas, pagamentos, outbox e inbox`; `…drawio:197` `Anúncios, pedidos recebidos, cursores de polling, outbox e inbox`; C4 gate `OK`; PNG shows both | Same | ✅ PASS |
| PLAT-22 | no `a definir` in `.drawio` or PNG | `grep -ci 'a definir'` on the `.drawio` → `0` (inside C4 gate → `OK`); PNG viewed in iteration 2, no "a definir"; PNG unchanged since `f2de875` | Same | ✅ PASS |

**Status**: ✅ 22/22 ACs covered, 0 spec-precision gaps.

---

## Discrimination Sensor

The gates were extracted verbatim from tasks.md (`sed -n '50,53p'` for the eventos gate, `sed -n '59,65p'` for the C4 gate). Each mutant went into a fresh scratch copy of `docs/eventos.md` and the `.drawio` (`/tmp/claude-1000/-home-zeciola-Documents-PUC-Minas-arquteitura-multiplataforma-trabalho-final/a344cdb3-242c-4c1c-b089-22558bf4bad5/scratchpad/verifier3/m`), and `diff -r --brief` confirmed 1 changed file per mutant. Controls on the unmutated copy print `OK` for both gates.

| # | File:line (copy of) | Mutation | Gate | Killed? |
| --- | --- | --- | --- | --- |
| M10 | `docs/eventos.md:619` | adds `create order.order.confirmed.v1 3` | eventos | ✅ Killed |
| M11 | `docs/eventos.md:619` | re-adds the pending list as prose (`Pendentes (#14): order.order.confirmed.v1, billing.order-events.dlq`) | eventos | ✅ Killed |
| M14 | `docs/eventos.md:617` | heading back to `Tópicos novos para o \`create-topics.sh\` (#14)` | eventos | ✅ Killed |
| M12 | `…drawio:192` | billing-db description → `Cobranças (A Definir, #14)` | C4 | ✅ Killed |
| M13 | `…drawio:147` | `Go 1.27` → `Go 1.26` | C4 | ✅ Killed |
| M15 | `…drawio:137` | `Node.js 22` → `Node.js 20` | C4 | ✅ Killed |
| M16 | `…drawio:197` | `, outbox e inbox` → ` e outbox` | C4 | ✅ Killed |

Iteration 2's other mutants (M11b, M11c, M17, M18, all killed) and iteration 1's runtime mutants (M1–M9, all killed) still apply, because the gates and files they cover have not changed since.

**Sensor depth**: lightweight (infra/docs, not P0); 7 mutants re-run, M11 and M13 among them, as asked
**Result**: 7/7 killed ✅ (cumulative: 11/11 in iteration 2)

---

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum code | ✅ `c4ecd6b` is 10/10 lines of text; the whole range adds no infra code |
| Surgical changes | ✅ 6 files, all in scope |
| No scope creep | ✅ |
| Matches patterns | ✅ every runnable `make` instruction uses the `compose-*` names, like `README.md:146-159` and `CLAUDE.md` |
| Spec-anchored outcome check | ✅ |
| Per-layer Coverage Expectation met | ✅ |
| Every check maps to a spec requirement | ✅ |
| Documented guidelines followed: `CLAUDE.md` (Conventional Commits in Portuguese) | ✅ all 12 commits |

---

## Edge Cases

- [ ] Port already allocated → only that container fails: not tested, because it would disturb the shared running stack. This is Docker's default behaviour and is not verified (unchanged from iterations 1 and 2; not an AC).
- [x] Kafka not healthy → `kafka-init` does not start: `docker-compose.yaml:198`, `:207` (`depends_on kafka: condition: service_healthy`), carried over (iter 2).
- [x] Old volume keeps its password; the fix is `make compose-clean`: `CLAUDE.md:56`, `README.md:189`; `make -n compose-clean` → rc 0.

---

## Gate Check

Gate commands from `tasks.md:38-66`, run as written.

| Gate | Command (as written) | Result |
| --- | --- | --- |
| Static | `docker compose config -q && echo OK` | ✅ `OK` |
| Topics diff | eventos gate (`tasks.md:50-53`) | ✅ `OK` (rc 0) |
| C4 labels | C4 gate (`tasks.md:59-65`) | ✅ `OK` (rc 0) |
| Smoke | `make compose-up-infra` … `docker inspect …` … `make compose-topics` (`tasks.md:43`) | ✅ `make -n compose-up-infra` rc 0 (not executed: the apps were running and the target would scale them to 0); `docker inspect` → 3× `healthy`; `make compose-topics` rc 0, `kafka-init` exit 0 |
| CI | `gh run list --commit <sha>` | ✅ carried over (iter 2): single-workflow runs for `62d1d8c4`, `6be4e60a`, `b171a982`, `7e662302`; the range is docs-only |

Other range checks: 0 blobs > 100 MB in `0731899..HEAD` (largest 1,618,603 B); 0 paths with `oracleJdk`; `diff .specs/features/new-services-infra/spec.md docs/specs/plataforma/infra-servicos-novos/spec.md` → no output.

- **Result**: 5 passed, 0 failed, 0 skipped
- **Test count before/after feature**: 0 / 0 (the root infra has no test suite; delta 0)

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| --- | --- | --- |
| PLAT-01..PLAT-22 | Implementing | ✅ Verified |

(Not written to spec.md: the Verifier changes nothing in the tree except this report.)

---

## Isolation

`git status --porcelain` before and after the run is the same: ` M .claude/skills/tlc-spec-driven/.skill-meta.json` plus untracked `.agents/`, `.claude/skills/{best-practices,coding-guidelines,decomposition-planning-roadmap,nx-ci-monitor}/`, `.cursor/`, `.specs/features/new-services-infra/validation.md`, `.windsurf/`, `docs/analise-repositorio.md`. This report was already untracked, so only its content changed. Every mutation ran in scratch. The only command that changed Docker state was `make compose-topics`, which is allowed and idempotent. The `make -n` calls are dry runs.

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 22/22 ACs matched the spec outcome; 0 spec-precision gaps
**Sensor**: 7/7 mutations killed this iteration (11/11 in iteration 2)
**Gate**: Static, Topics diff, C4, Smoke and CI pass

**What works**: the databases, volumes and health checks; `compose-up-infra` leaving the apps out; the password guard; the ports; the 15 topics and the idempotent `compose-topics`; the reusable workflows and CI isolation; the README tables; the eventos.md cleanup; the C4 `.drawio` and PNG. The docs and gates now name only targets that exist.

**Issues found**: none.

**Next steps**: PR #83 can be merged into `dev`, and the issue #14 requirements can be marked Verified.

---

## Deterministic check

`python3 .claude/skills/tlc-spec-driven/scripts/validate_state.py new-services-infra` → exit 0:

```
validate_state: 0 error(s) across [new-services-infra]
```
