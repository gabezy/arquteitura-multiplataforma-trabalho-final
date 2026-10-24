# New services infra Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Spec**: `.specs/features/new-services-infra/spec.md`
**Design**: skipped - no architectural decision; the infra follows ADR-0001 and the patterns already on `dev`
**Status**: Done (pending re-verification)

**Nature of the tasks:** the infra of #14 is already on `dev`. Most tasks verify a group of requirements and record the evidence (command and output) under the task. They change files only when the check finds a gap. Each task ends in one commit with the traceability update, plus the fix when there is one.

**Rebase on `origin/dev` (2026-10-24):** after T1–T7, the branch was rebased onto `origin/dev` (`0731899`), which renamed the Makefile targets to `compose-*`. The evidence below was recorded with `make up-infra` and `make topics` before the rebase. After the rebase the checks were run again with the new names: `make compose-up-infra` → the 3 databases `healthy` and 0 of the 3 apps started; `make compose-topics` → `kafka-init` exit 0 and the 15 topics present; `docker compose config -q`, eventos gate and C4 gate → `OK`. `dev` changed only comments in the compose and added `catalog.product.price-changed.v1` (catalog, out of scope).

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. There is no test framework for the root infra (compose, Makefile, `create-topics.sh`, workflows), so the checks are commands whose output is compared with the values the spec defines.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Compose (databases, ports, volumes) | static check + smoke | Every port, volume, image and health status in PLAT-01..05, PLAT-15, PLAT-16 | `docker-compose.yaml` | `docker compose config` + `make compose-up-infra` |
| Kafka topics | smoke | Partitions and `retention.ms` of the 15 topics in PLAT-06, PLAT-07; second run exits 0 (PLAT-08) | `docker/kafka/create-topics.sh` | `make compose-topics` + `kafka-topics.sh --describe` |
| Event catalog doc | none (static check) | No topic of the script listed as pending (PLAT-09) | `docs/eventos.md` | topics diff (Gate Check Commands) |
| CI workflows | none (static check + GitHub Actions evidence) | Reusable workflow per stack and isolation per service (PLAT-10..14) | `.github/workflows/*.yml` | `gh run list --commit <sha>` |
| README and spec copy | none (static check) | Tables match the compose (PLAT-17, PLAT-18) | `README.md` | `grep` against the compose ports |
| C4 diagram | none (static check + visual check of the PNG) | Every label in PLAT-19..22 | `docs/c4/` | `grep -ci 'a definir'` on the `.drawio` |

## Gate Check Commands

> Generated from codebase - confirm before Execute. Smoke gates need Docker and a `.env` (`make env`). The CI gate needs `gh` authenticated on `gabezy/arquteitura-multiplataforma-trabalho-final`.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Static | Tasks that read or change compose, docs or workflows | `docker compose config -q && echo OK` |
| Topics diff | Tasks that touch `docs/eventos.md` or `create-topics.sh` | Script "eventos gate" below prints `OK` |
| C4 labels | Tasks that touch the C4 `.drawio` | Script "C4 gate" below prints `OK` |
| Smoke | Tasks that check runtime behaviour | `make compose-up-infra`, then after 60 s `docker inspect -f '{{.Name}} {{.State.Health.Status}}' order-db billing-db marketplace-db` and `make compose-topics` |
| CI | Tasks that check the workflows | `gh run list --commit <sha> --json workflowName,event,status,conclusion` |


**eventos gate** (the section exists, there are no `create` lines in the file, and the section names no topic):

```sh
f=docs/eventos.md
[ "$(grep -c '^## Tópicos no `create-topics.sh`' "$f")" = 1 ] &&
[ "$(grep -c '^create ' "$f")" = 0 ] &&
[ "$(sed -n '/^## Tópicos no `create-topics.sh`/,/^## Como adicionar/p' "$f" | grep -cE '[a-z-]+\.[a-z.-]+\.(v[0-9]+|dlq)')" = 0 ] && echo OK
```

**C4 gate** (each of the four labels is exact on the line of its element, and no `a definir` is left):

```sh
f="docs/c4/Omni Market - C4 Model Contexto.drawio"
chk() { [ "$(grep -F "$1" "$f" | grep -cF "$2")" = 1 ]; }
chk 'c4Name="billing-service"' 'c4Technology="Go 1.27, net/http"' &&
chk 'c4Name="marketplace-gateway"' 'c4Technology="Node.js 22, TypeScript, Express 5"' &&
chk 'c4Name="billing-db"' 'c4Description="Faturas, pagamentos, outbox e inbox"' &&
chk 'c4Name="marketplace-db"' 'c4Description="Anúncios, pedidos recebidos, cursores de polling, outbox e inbox"' &&
[ "$(grep -ci 'a definir' "$f")" = 0 ] && echo OK
```

Both gates were checked against mutated copies: a pending list re-added as prose, a re-added `create` line, `Go 1.26` instead of `Go 1.27`, and an `a definir` label put back. Each gate rejects all of them (Verifier fix 3).

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: Fix the known gap

```
T1
```

### Phase 2: Verify the local environment

```
T2 → T3
```

### Phase 3: Verify CI and docs

```
T4 → T5
T6
T7
```

---

## Task Breakdown

### T1: Remove the stale pending-topics list from `docs/eventos.md`

**What**: Replace the body of the "Tópicos novos para o `create-topics.sh` (#14)" section with one sentence saying that every topic of the catalog, with its DLQs, is created by `docker/kafka/create-topics.sh`, and that a new topic follows "Como adicionar ou mudar um evento".
**Where**: `docs/eventos.md`
**Depends on**: None
**Reuses**: the steps of "Como adicionar ou mudar um evento" in the same file
**Requirement**: PLAT-09

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] The section lists no `create` line
- [x] Every topic in the old list is in `create-topics.sh` (checked before deleting it)
- [x] The anchor links to the section, if any, still resolve
- [x] PLAT-09 marked `Implementing` in the spec traceability

**Tests**: none (static check)
**Gate**: Topics diff

**Evidence (2026-10-24):**

- Before the change, each of the 13 `create` lines of the section was found in `create-topics.sh` (`grep -qE "^create $t "`, 13 × `ok`).
- No Markdown file links to the section (`grep -rn --include='*.md' 'picos-novos'` finds nothing outside this feature).
- The section was renamed to "Tópicos no `create-topics.sh`" and now points to the script and to "Como adicionar ou mudar um evento".
- Gate: `grep -c '^create ' docs/eventos.md` → `0`. Re-run with the stronger eventos gate after Verifier fix 3 → `OK`.
- Adjustment: the gate now counts `create` lines in the whole file, because the section heading changed and the old `sed` range would match nothing.

**Status**: ✅ Complete

---

### T2: Verify the databases and ports in the compose

**What**: Check PLAT-01..05, PLAT-15 and PLAT-16 against `docker compose config` and a `make compose-up-infra` run, and record each command with its output under this task; fix the compose only if a check fails.
**Where**: `docker-compose.yaml` (only if a gap is found)
**Depends on**: None
**Reuses**: `order-db` as the reference shape for the other two databases
**Requirement**: PLAT-01, PLAT-02, PLAT-03, PLAT-04, PLAT-05, PLAT-15, PLAT-16

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `docker compose config --format json` shows ports 5434/5435/5436, image `postgres:18-alpine` and the three named volumes at `/var/lib/postgresql` (PLAT-01, PLAT-03)
- [x] After `make compose-up-infra` and 60 s, the three databases report `healthy` (PLAT-02)
- [x] `make compose-ps` after `make compose-up-infra` lists none of `order-service`, `billing-service`, `marketplace-gateway` (PLAT-04)
- [x] `ORDER_DB_PASSWORD= docker compose config` fails with a message containing `run make env` (PLAT-05)
- [x] Host ports 8084/8086/8087 belong to the three services and 8085 only to `keycloak` (PLAT-15, PLAT-16)
- [x] Evidence recorded below and PLAT-01..05, PLAT-15, PLAT-16 marked `Implementing`

**Tests**: smoke
**Gate**: Static + Smoke

**Evidence (2026-10-24):**

- `docker compose config -q` → exit 0.
- `docker compose config --format json` (PLAT-01, PLAT-03): `order-db` `postgres:18-alpine` `5434:5432` volume `order-db-data:/var/lib/postgresql`; `billing-db` `postgres:18-alpine` `5435:5432` `billing-db-data:/var/lib/postgresql`; `marketplace-db` `postgres:18-alpine` `5436:5432` `marketplace-db-data:/var/lib/postgresql`; all three have a `healthcheck`.
- Published host ports (PLAT-15, PLAT-16): `8084 → order-service`, `8086 → billing-service`, `8087 → marketplace-gateway`, `8085 → keycloak` only.
- `make up-infra` at 17:11 UTC; at 17:12:08 UTC `docker inspect` printed `/order-db healthy`, `/billing-db healthy`, `/marketplace-db healthy` (started 17:11:10–17:11:15, under 60 s) (PLAT-02).
- `docker compose ps -a` after `make up-infra` lists none of `order-service`, `billing-service`, `marketplace-gateway` (PLAT-04).
- PLAT-05, isolated check: a copy of `.env` without only the `ORDER_DB_PASSWORD` line, then `env -u ORDER_DB_PASSWORD docker compose --env-file <copy> config -q` → exit 1 with `required variable ORDER_DB_PASSWORD is missing a value: run make env`. Control with the full `.env`: `docker compose config -q` → exit 0. This replaces the first reading, which used `--env-file /dev/null` and emptied every variable (Verifier fix 4).
- No gap found; `docker-compose.yaml` unchanged.

**Status**: ✅ Complete

---

### T3: Verify the Kafka topics

**What**: Run `make compose-topics` twice and describe the 15 topics of PLAT-06 and PLAT-07, recording partitions and `retention.ms`; fix `create-topics.sh` only if a topic is missing or wrong.
**Where**: `docker/kafka/create-topics.sh` (only if a gap is found)
**Depends on**: T2
**Reuses**: the `create` helper of the script
**Requirement**: PLAT-06, PLAT-07, PLAT-08

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] The 9 event topics have 3 partitions (PLAT-06)
- [x] The 6 DLQs have 1 partition and `retention.ms=1209600000` (PLAT-07)
- [x] The second `make compose-topics` leaves `kafka-init` exited with code 0 and every partition count unchanged (PLAT-08)
- [x] Evidence recorded below and PLAT-06..08 marked `Implementing`

**Tests**: smoke
**Gate**: Smoke + Topics diff

**Evidence (2026-10-24):**

- First run: `kafka-init` from `make up-infra` exited 0 at 17:12:00 UTC.
- `kafka-topics.sh --describe --topic <t>` (PLAT-06): `order.order.placed.v1`, `order.order.cancelled.v1`, `order.order.confirmed.v1`, `marketplace.order.received.v1`, `marketplace.listing.published.v1`, `marketplace.listing.failed.v1`, `billing.invoice.issued.v1`, `billing.payment.confirmed.v1`, `billing.payment.failed.v1` → `PartitionCount: 3` each.
- Same command (PLAT-07): `order.marketplace-order.dlq`, `order.stock-response.dlq`, `order.billing-payment.dlq`, `marketplace.catalog-product.dlq`, `marketplace.order-cancelled.dlq`, `billing.order-events.dlq` → `PartitionCount: 1` and `retention.ms=1209600000` each.
- Second run (PLAT-08): `make topics` at 17:12:59 UTC; `kafka-init` → `status=exited exit=0` at 17:13:34 UTC, no `error` or `exception` in its log; `--describe` afterwards shows the same partition count for all 15 topics.
- Gate: `grep -c '^create ' docs/eventos.md` → `0`.
- No gap found; `create-topics.sh` unchanged.

**Status**: ✅ Complete

---

### T4: Verify the reusable workflow of each stack

**What**: Check that `order-service.yml` and `marketplace-gateway.yml` call `_node-service.yml` and `billing-service.yml` calls `_go-service.yml`, and that each `paths` filter covers only its service, its own workflow and its reusable workflow (plus the simulator paths of `marketplace-gateway.yml`).
**Where**: `.github/workflows/` (only if a gap is found)
**Depends on**: None
**Reuses**: `catalog-service.yml` as the reference shape
**Requirement**: PLAT-10

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `uses:` of each `ci` job points to the stack's reusable workflow (PLAT-10)
- [x] No service workflow lists another service's directory in `paths`
- [x] Evidence recorded below and PLAT-10 marked `Implementing`

**Tests**: none (static check)
**Gate**: Static

**Evidence (2026-10-24):**

- `uses:` of the `ci` job (PLAT-10): `order-service.yml` → `./.github/workflows/_node-service.yml`; `marketplace-gateway.yml` → `./.github/workflows/_node-service.yml`; `billing-service.yml` → `./.github/workflows/_go-service.yml`.
- `paths` of `push` and `pull_request` (same list in both triggers):
  - `order-service.yml`: `order-service/**`, `.github/workflows/order-service.yml`, `.github/workflows/_node-service.yml`.
  - `billing-service.yml`: `billing-service/**`, `.github/workflows/billing-service.yml`, `.github/workflows/_go-service.yml`.
  - `marketplace-gateway.yml`: `marketplace-gateway/**`, its own workflow, `_node-service.yml`, `docker/wiremock/mappings/{amazon,mercadolivre,shopee}.json`, `docker/wiremock/__files/{amazon,mercadolivre,shopee}/**`, `scripts/simulate-order.sh`, `scripts/simulate-failure.sh`.
- No service workflow (all six checked) lists another service's directory in `paths`.
- Gate: `docker compose config -q` → exit 0.
- No gap found; workflows unchanged.

**Status**: ✅ Complete

---

### T5: Collect GitHub Actions evidence of CI isolation

**What**: Find, with `git log --format=%H -- <service>/` and `git show --stat`, one `dev` commit (or merged PR head) per service that touches only that service, plus one that touches only `_node-service.yml`, and record the workflows `gh run list --commit <sha>` shows for each.
**Where**: evidence under this task (no code change)
**Depends on**: T4
**Reuses**: NONE
**Requirement**: PLAT-11, PLAT-12, PLAT-13, PLAT-14

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `order-service`-only commit: runs list only the `order-service` workflow (PLAT-11)
- [x] `billing-service`-only commit: runs list only the `billing-service` workflow (PLAT-12)
- [x] `marketplace-gateway`-only commit: runs list only the `marketplace-gateway` workflow (PLAT-13)
- [x] `_node-service.yml`-only commit: runs list `catalog-service`, `order-service` and `marketplace-gateway` (PLAT-14); if no such commit exists, record that and use the static `paths` check of T4 as the evidence
- [x] No test commit is pushed to collect evidence (pushing needs an explicit go-ahead)
- [x] Evidence recorded below and PLAT-11..14 marked `Implementing`

**Tests**: none (GitHub Actions evidence)
**Gate**: CI

**Evidence (2026-10-24):**

Source: the 110 `push` runs of `gh api repos/gabezy/arquteitura-multiplataforma-trabalho-final/actions/runs?event=push`, grouped by `head_sha`. The files come from `gh api .../commits/<sha>`, and the push range from `gh api .../activity` (`before`) plus `gh api .../compare/<before>...<after>`. `git fetch` has no SSH access here, so the GitHub API was used.

- PLAT-11: `62d1d8c4` (`feature/20-pedidos-do-order-service`, 1 commit, only `order-service/**`) → workflows run: `order-service` only.
- PLAT-12: `6be4e60a` (`feature/32-pagamento-psp`, only `billing-service/**`) → `billing-service` only.
- PLAT-13: `b171a982` (`feature/33-sincronizar-estoque`, `marketplace-gateway/CLAUDE.md` + `README.md`, which no filter matches) → `marketplace-gateway` only. Same for `7e662302`.
- Other single-service commits behave the same way: `0dcfe805`, `a77cf3a3`, `703dd42a` → `catalog-service` only; `7fb8c4d0`, `490d66ff`, `6d1796d2` → `bff-gateway` only.
- Runs with more workflows than the commit's own files: in each case the push range touched those paths, so the filters behaved as intended.
  - `b5e2bd3e`: `branch_creation`, compared with the default branch.
  - `843e3e97`: 2 commits touching `bff-gateway` and `catalog-service`.
  - `8cd380d8`: 10 commits.
  - `226602b0`: 151 commits touching every service.
  - `b9e89c4c` and `ecec1e79`: they changed `scripts/simulate-order.sh` and `scripts/simulate-failure.sh`, which are in the `marketplace-gateway` filter.
- PLAT-14: no pushed commit changes only `.github/workflows/_node-service.yml`. As the task allows, the evidence is the static check of T4: `_node-service.yml` is in the `paths` of `catalog-service.yml`, `order-service.yml` and `marketplace-gateway.yml`, and of no other workflow.
- No test commit was pushed.

**Status**: ✅ Complete

---

### T6: Check the README tables and sync the spec copy

**What**: Compare the README services and components tables with the compose (PLAT-17, PLAT-18), fix any mismatch, and copy the spec to `docs/specs/plataforma/infra-servicos-novos/spec.md`.
**Where**: `README.md`, `docs/specs/plataforma/infra-servicos-novos/spec.md`
**Depends on**: None
**Reuses**: the existing table rows of `catalog-db` and `compliance-db`
**Requirement**: PLAT-17, PLAT-18

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Services table: `order-service` 8084, `billing-service` 8086, `marketplace-gateway` 8087 (PLAT-17)
- [x] Components table: `order-db` 5434, `billing-db` 5435, `marketplace-db` 5436, each with its user and password source (PLAT-18)
- [x] `diff .specs/features/new-services-infra/spec.md docs/specs/plataforma/infra-servicos-novos/spec.md` prints nothing
- [x] PLAT-17 and PLAT-18 marked `Implementing`

**Tests**: none (static check)
**Gate**: Static

**Evidence (2026-10-24):**

- README services table (PLAT-17): `README.md:24` `order-service` … `8084`; `README.md:25` `billing-service` … `8086`; `README.md:26` `marketplace-gateway` … `8087`. These match the compose ports from T2.
- README components table (PLAT-18): `README.md:176` `order-db` `localhost:5434` `orders` / `ORDER_DB_PASSWORD` do `.env`; `README.md:177` `billing-db` `localhost:5435` `billing` / `billing`; `README.md:178` `marketplace-db` `localhost:5436` `marketplace` / `marketplace`. These match the compose defaults (`BILLING_DB_PASSWORD:-billing`, `MARKETPLACE_DB_PASSWORD:-marketplace`).
- No gap found; `README.md` unchanged.
- Spec copied to `docs/specs/plataforma/infra-servicos-novos/spec.md` after this task's traceability update; `diff` prints nothing.

**Status**: ✅ Complete

---

### T7: Update the C4 container diagram

**What**: Set `c4Technology` of `billing-service` and `marketplace-gateway` and `c4Description` of `billing-db` and `marketplace-db` in the `.drawio` XML to the values of PLAT-19..21, then re-export the `C4 - Container` page to its PNG in draw.io desktop.
**Where**: `docs/c4/Omni Market - C4 Model Contexto.drawio`, `docs/c4/Omni Market - C4 Model Contexto-C4 - Container.drawio.png`
**Depends on**: None
**Reuses**: the labels of `order-service` and `order-db` as the style reference
**Requirement**: PLAT-19, PLAT-20, PLAT-21, PLAT-22

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `billing-service` shows `Go 1.27, net/http` and `marketplace-gateway` shows `Node.js 22, TypeScript, Express 5` (PLAT-19, PLAT-20)
- [x] `billing-db` and `marketplace-db` show the descriptions of PLAT-21
- [x] `grep -ci 'a definir'` on the `.drawio` prints `0` (PLAT-22)
- [x] The re-exported PNG shows the four new labels; the PNG export is done by a person with draw.io desktop, since the CLI is not installed (PLAT-22)
- [x] The `.drawio` still opens in draw.io with no other change to the diagram
- [x] PLAT-19..22 marked `Implementing`

**Tests**: none (static check)
**Gate**: Static + C4 labels

**Evidence (2026-10-24):**

- `.drawio` attributes changed (4 lines, nothing else): `marketplace-gateway` `c4Technology="Node.js 22, TypeScript, Express 5"`, `billing-service` `c4Technology="Go 1.27, net/http"`, `billing-db` `c4Description="Faturas, pagamentos, outbox e inbox"`, `marketplace-db` `c4Description="Anúncios, pedidos recebidos, cursores de polling, outbox e inbox"` (PLAT-19..21).
- `grep -ci 'a definir'` on the `.drawio` → `0` (PLAT-22, `.drawio` half).
- C4 gate → `OK` (exact labels, added after Verifier fix 3).
- `xml.dom.minidom.parse` on the `.drawio` → parses with no error.
- Executed before T6, so the spec copy made in T6 includes this task's status.
- PNG exported from the committed `.drawio` with headless draw.io (`docker run rlespinasse/drawio-export:v4.47.0 -f png --width 3674`), page `C4 - Container` → 3674 × 3151 px (was 3674 × 3154). Checked by eye: `billing-service` `[Container: Go 1.27, net/http]`, `marketplace-gateway` `[Container: Node.js 22, TypeScript, Express 5]`, `billing-db` `Faturas, pagamentos, outbox e inbox`, `marketplace-db` `Anúncios, pedidos recebidos, cursores de polling, outbox e inbox`; no "a definir" left. The layout matches the old PNG (PLAT-22, PNG half). The context PNG was not touched.

**Status**: ✅ Complete
