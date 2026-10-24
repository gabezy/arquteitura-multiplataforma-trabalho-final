## Validation: order-service-bootstrap - PASS ✅

**Date**: 2026-10-24
**Spec**: `.specs/features/order-service-bootstrap/spec.md` (38 ACs, BOOT-01..BOOT-38)
**Diff range**: `origin/dev...HEAD` = `c120719..10041ac` (9 commits, 54 files) on `feature/15-bootstrap-order-service`
**Verifier**: independent sub-agent (author ≠ verifier), evidence-or-zero
**Verdict**: PASS. All 38 ACs have evidence. 21 are covered by automated tests and 17 by static reading plus read-only live or scratch checks (layer "none" by design). The sensor killed 20/20 mutants. BOOT-22/23 live CI run: **green** after the push ([run 40043761679](https://github.com/gabezy/arquteitura-multiplataforma-trabalho-final/actions/runs/40043761679), added by the orchestrator). The non-blocking observations are listed at the end.

---

## Task Completion

| Task | Status | Notes |
| --- | --- | --- |
| T1 | ✅ Done | - |
| T2 | ✅ Done | - |
| T3 | ✅ Done | - |
| T4 | ✅ Done | - |
| T5 | ✅ Done | - |
| T6 | ✅ Done | 3 deviations recorded in tasks.md (no `*.factory.ts` yet, `migrate.ts` builds a connection, `instrumentation.ts` no longer exits) |
| T7 | ✅ Done | Live run after push is still open (`[ ]` in tasks.md), pending user go-ahead |
| T8 | ✅ Done | Spec copy `docs/specs/order-service/bootstrap/spec.md` identical to source (`diff` empty) |

---

## Spec-Anchored Acceptance Criteria

Paths are relative to `order-service/` unless they start at the repo root.

### P1: Service runs in the local environment

| AC | Spec-defined outcome | Evidence (`file:line` + assertion / check) | Result |
| --- | --- | --- | --- |
| BOOT-01 | compose starts `order-db` (Postgres 18, host 5434) and `order-service` (host 8084); service waits for `order-db` healthy and `kafka-init` completed | Static: `docker-compose.yaml` `order-db` `image: postgres:18-alpine`, `"5434:5432"`, healthcheck `pg_isready`; `order-service` `"8084:8084"`, `depends_on: order-db: service_healthy, kafka-init: service_completed_successfully`. Live: `docker inspect` → `order-db running healthy ports 5434`, `order-service running healthy ports 8084`; `select version()` → `PostgreSQL 18.6` | ✅ PASS (static + live) |
| BOOT-02 | every pending migration applied before listening | Static: `Dockerfile:42` `npm run --silent migrate:deploy && exec node ...`. Live: `docker logs order-service` shows `Applied 2 migration(s)` before `order-service listening`; `\dt` lists `knex_migrations`, `outbox`, `processed_events` | ✅ PASS (static + live) |
| BOOT-03 | failed migration exits 1, no listen | `src/infra/persistence/migrations.spec.ts:93` `expect(result.status).toBe(1)` and `:96` `toContainEqual(objectContaining({ level: 50, msg: 'Migration failed' }))` (spawns `migrate.ts` against `127.0.0.1:1`). The "no listen" part is `Dockerfile:42` `&&` | ✅ PASS |
| BOOT-04 | `make up-infra` starts `order-db`, not `order-service` | `make -n up-infra` → `docker compose -f docker-compose.yaml up -d --scale bff-gateway=0 --scale catalog-service=0 --scale compliance-service=0 --scale order-service=0`; `Makefile:3` `APPS := ... order-service` | ✅ PASS (static) |
| BOOT-05 | second start applies nothing, logs `Database already up to date` | `src/infra/persistence/migrations.spec.ts:73` `expect(await runMigrations(db, second.logger)).toBe(true)`, `:74` `toEqual(['Database already up to date'])`, `:75` `knex_migrations` names exact. Scratch: second `node dist/infra/persistence/migrate.js` → `Database already up to date`, exit 0 | ✅ PASS |

### P1: Health check reflects the database

| AC | Spec-defined outcome | Evidence | Result |
| --- | --- | --- | --- |
| BOOT-06 | `200` `{"status":"UP"}` when `select 1` succeeds | `src/infra/http/health/health.routes.spec.ts:27` `toBe(200)`, `:28` `toEqual({ status: 'UP' })`; `src/infra/persistence/database-probe.spec.ts:23` real Postgres `resolves.toBeUndefined()`; `src/infra/persistence/database-probe.ts:20` runs `db.raw('select 1')`. Live: `curl -i localhost:8084/health` → `200` `{"status":"UP"}` | ✅ PASS |
| BOOT-07 | `503` `{"status":"DOWN"}` on failure or > 2 s | `src/infra/http/health/health.routes.spec.ts:37` `toBe(503)`, `:38` `toEqual({ status: 'DOWN' })`; `src/infra/persistence/database-probe.spec.ts:29` `rejects.toThrow('ECONNREFUSED')`, `:48` rejects at exactly 2000 ms with `'Database did not answer within 2000 ms'`, `:60` still pending at 1999 ms | ✅ PASS |
| BOOT-08 | DOWN logs the database error at `warn` | `src/infra/http/health/health.routes.spec.ts:39` `toHaveLength(1)`, `:40` `toMatchObject({ level: 40, err: { message: 'connect ECONNREFUSED 127.0.0.1:5434' } })` | ✅ PASS |

### P1: Configuration

| AC | Spec-defined outcome | Evidence | Result |
| --- | --- | --- | --- |
| BOOT-09 | defaults `8084`, `info`, `order-service`, `http://localhost:4318`, `postgresql://orders:orders@localhost:5434/orders`, `localhost:9092` | `src/infra/config/env.spec.ts:5` `expect(loadConfig({})).toEqual({...})`, all six values exact (`:6`-`:11`) | ✅ PASS |
| BOOT-10 | invalid PORT → `Invalid PORT: <value>`, exit 1 | `src/infra/config/env.spec.ts:47` `toThrow(\`Invalid PORT: ${port}\`)` for `abc`, `0`, `65536`, `80.5`; `:43` accepts `1`, `65535`. Exit code: `src/main.ts:42-45` `catch → process.exit(1)`. Scratch: `PORT=abc node --require ./dist/.../instrumentation.js dist/main.js` → exit 1, `Invalid PORT: abc`; without preload → pino `level 50` record with `Invalid PORT: abc`, exit 1 | ✅ PASS (see observation 3) |
| BOOT-11 | `dev`, `start`, `migrate` load `.env` when present | Static: `package.json:6`, `:8`, `:13` `--env-file-if-exists=.env`. Scratch: `node`, `tsx` and `tsx watch` with `--env-file-if-exists=.env` printed the `.env` value (`4242`/`4343`); without `.env` → `unset` and no error | ✅ PASS (static + scratch) |
| BOOT-12 | `.env.example` lists every env var read, with defaults | `.env.example:1-6` lists `PORT=8084`, `LOG_LEVEL=info`, `OTEL_SERVICE_NAME=order-service`, `OTEL_COLLECTOR_URL=http://localhost:4318`, `DATABASE_URL=postgresql://orders:orders@localhost:5434/orders`, `KAFKA_BROKERS=localhost:9092`. `grep env\.` over `src` and `knexfile.ts` finds only these six | ✅ PASS (static) |
| BOOT-28 | comma list, each entry trimmed | `src/infra/config/env.spec.ts:36` `toEqual(['kafka-1:19092', 'kafka-2:19092'])` from `'kafka-1:19092, kafka-2:19092'` | ✅ PASS |

### P1: Observability

| AC | Spec-defined outcome | Evidence | Result |
| --- | --- | --- | --- |
| BOOT-13 | HTTP span with `service.name=order-service` exported over OTLP HTTP | Static: `src/infra/observability/instrumentation.ts:15-16` `serviceName`, `OTLPTraceExporter({ url: \`${otelCollectorUrl}/v1/traces\` })`, auto-instrumentations. Live (Grafana → Tempo): TraceQL `{resource.service.name="order-service" && span.http.route="/health"}` → trace `141077e2…` root `GET /health`, span attribute `service.name=order-service` | ✅ PASS (static + live) |
| BOOT-14 | in-request logs carry `trace_id`/`span_id` and are exported over OTLP | Static: `src/infra/observability/instrumentation.ts:22-26` `OTLPLogExporter` + pino auto-instrumentation. Live: `docker logs` record `Health check failed: database unavailable` has `trace_id 4014a1a0…`; Loki `{service_name="order-service"}` returns `Client error` and `Health check failed…` with `trace_id` and `span_id` labels | ✅ PASS (static + live) |
| BOOT-15 | `order-service listening` with the port at `info` | Static: `src/main.ts:26` `logger.info({ port: config.port }, \`${config.serviceName} listening\`)`. Live: `{"level":30,…,"port":8084,"msg":"order-service listening"}` | ✅ PASS (see observation 2) |

### P1: Graceful shutdown

| AC | Spec-defined outcome | Evidence | Result |
| --- | --- | --- | --- |
| BOOT-16 | on `SIGTERM`/`SIGINT`: close server, wait for the relay round, disconnect producer, close pool, exit 0 | Static: `src/main.ts:29-39` in that order (`server.close()`, `await relay.stop()`, `await producer.disconnect()`, `await db.destroy()`, `process.exit(0)`, `process.once` for both signals); `src/infra/observability/instrumentation.ts:38-42` only flushes the SDK, no exit. Test: `src/infra/messaging/outbox-relay.spec.ts:327` `expect(await pendingCount()).toBe(0)` after `stop()` while a send is in flight (stop waits for the round). Scratch: built service with the instrumentation preload, scratch Postgres + local Kafka: `SIGTERM` → exit 0 in 21 ms, `SIGINT` → exit 0 in 24 ms; both logged `order-service shutting down`; 0 connections left in `pg_stat_activity` | ✅ PASS |
| BOOT-17 | image runs node as PID 1, non-root | Static: `Dockerfile:32` `USER order`, `:42` `exec node …`. Live: `docker exec order-service id -u` → `100`; `/proc/1/cmdline` → `node --require ./dist/infra/observability/instrumentation.js dist/main.js`; `Config.User=order` | ✅ PASS (static + live) |

### P1: Hexagonal structure

| AC | Spec-defined outcome | Evidence | Result |
| --- | --- | --- | --- |
| BOOT-18 | `src/core` imports none of `express`, `knex`, `pg`, `pino`, `kafkajs`, `@opentelemetry/*`, `src/infra` | `src/core/architecture.spec.ts:44` `expect(violations).toEqual([])` over every non-spec `.ts` in `src/core`; `:57` each of 8 planted imports (including `pg/lib/client` via `require` and a relative `infra` path) `toHaveLength(1)`; `:63` core/Node imports allowed | ✅ PASS |
| BOOT-19 | dependencies built only in `src/main.ts` and `src/infra/*.factory.ts` | Grep of construction calls outside specs: `src/main.ts:13-16,25` (logger, db, Kafka, relay, app, probe); `src/infra/persistence/migrate.ts:10-11` (marked `SPEC_DEVIATION`, separate process entry point); `src/infra/observability/instrumentation.ts:14` `new NodeSDK` (preload, not marked); `src/infra/messaging/kafka.config.ts:4` and `src/infra/persistence/database.ts:5` are helpers called only from `main.ts`/`migrate.ts`. No `*.factory.ts` yet (deviation recorded in T6) | ✅ PASS with ⚠️ spec-precision gap (observation 4) |
| BOOT-20 | non-domain, non-4xx error → `500` `application/problem+json`, no `detail` | `src/infra/http/error-handler.spec.ts:73` `toBe(500)`, `:74` content-type `application/problem+json`, `:75` `toEqual({ type, title: 'Internal Server Error', status: 500, instance })`. Exact equality, so any `detail` key fails the test (M5 killed) | ✅ PASS |
| BOOT-21 | `ValidationError`/`NotFoundError`/`ConflictError` → `422`/`404`/`409`, `application/problem+json` | `src/infra/http/error-handler.spec.ts:25` `toBe(status)` for 422/404/409, `:26` content-type, `:27` exact body. Also `:42`/`:44` 4xx Express error keeps 400; `:59-67` 4xx log has no request body (fix commit `85ae8ac`) | ✅ PASS |

### P1: Event publishing through the outbox

| AC | Spec-defined outcome | Evidence | Result |
| --- | --- | --- | --- |
| BOOT-29 | producer connects before listening | Static: `src/main.ts:18` `await producer.connect()` before `:25` `.listen(...)`; startup failures go to `:42` `catch`. Live: kafkajs producer warnings come before `order-service listening` in `docker logs` | ✅ PASS (static + live) |
| BOOT-30 | Kafka unreachable at startup → exit 1 | Static: `src/main.ts:18` → `:42-45` `process.exit(1)`. Scratch: `KAFKA_BROKERS=127.0.0.1:1 node dist/main.js` → exit 1 after 12 s, logged `order-service failed to start`, never logged `listening` | ✅ PASS (static + scratch) |
| BOOT-31 | one row per event: mapped `event_type`, mapped `payload`, `event_id`, `aggregate_id`, `occurred_at`, active W3C trace context in `headers`, `published_at` empty | `src/infra/persistence/knex-outbox.repository.spec.ts:74` `expect(rows).toEqual([{ event_id: event.eventId, aggregate_id: ORDER_ID, event_type: 'order.order.placed.v1', payload: { orderId, sku }, headers: { traceparent: '00-<trace>-<span>-01' }, occurred_at: event.occurredOn, published_at: null, … }])`. Every column checked by value. N>1 events → N rows: `src/infra/messaging/outbox-relay.spec.ts:84` (3 events → 3 messages) | ✅ PASS (observation 5) |
| BOOT-32 | unmapped event → repository throws, transaction writes no row | `src/infra/persistence/knex-outbox.repository.spec.ts:94` `rejects.toThrow('No integration event for Unmapped.')`, `:95` `toEqual({ total: '0' })` (mapped event first, unmapped second) | ✅ PASS |
| BOOT-33 | up to 100 pending rows, `sequence` order, topic = `event_type`, key = `aggregate_id`, value = payload JSON, then `published_at` set | `src/infra/messaging/outbox-relay.spec.ts:84-98` `toHaveBeenCalledWith({ topicMessages: [{ topic: 'test.SomethingHappened.v1', messages: [{ key: ORDER_ID, value: '{"value":42}' }, …] }, …] })`; `:107` first 100 of 150 in order; `:109` exactly those 100 have `published_at`; `:110` 50 still pending; `:137` not sent twice | ✅ PASS |
| BOOT-34 | headers `ce_specversion=1.0`, `ce_id`, `ce_source=/order-service`, `ce_type`, `ce_subject`, `ce_time` ISO-8601, `content-type=application/json` | `src/infra/messaging/outbox-relay.spec.ts:120` `expect(message.headers).toEqual({ ce_specversion: '1.0', ce_id: event.eventId, ce_source: '/order-service', ce_type: 'test.SomethingHappened.v1', ce_subject: ORDER_ID, ce_time: event.occurredOn.toISOString(), 'content-type': 'application/json' })`. Exact equality covers all seven headers by value | ✅ PASS |
| BOOT-35 | failed send: rows stay pending, `Failed to relay outbox messages` logged at `error`, retried next round | `src/infra/messaging/outbox-relay.spec.ts:144` `rejects.toThrow('broker down')`, `:145` pending `1`, `:149-150` retried, pending `0`; `:313` `onError` `toHaveBeenCalledWith(new Error('broker down'))` in the loop. Log text and level: `src/main.ts:22` `logger.error({ err }, 'Failed to relay outbox messages')` (static); live `docker logs` has a `level 50` `Failed to relay outbox messages` record from the `order-db` outage smoke | ✅ PASS (test + static + live) |
| BOOT-36 | rows locked by one round are skipped by another | `src/infra/messaging/outbox-relay.spec.ts:182` `maxInFlight` `toBe(2)` (both rounds sent at once), `:183-184` 150 ids, all distinct (M13 removed `skipLocked()` and was killed) | ✅ PASS |
| BOOT-37 | new round 1000 ms after the previous round ends | `src/infra/messaging/outbox-relay.spec.ts:283` gap between send starts `>= INTERVAL - 2` (200 ms); `:302` `maxInFlight` `toBe(1)` (rounds never overlap). The value 1000 is only in `src/main.ts:9` `RELAY_INTERVAL_MS = 1000` and `:21` (static) | ✅ PASS with ⚠️ (observation 1) |
| BOOT-38 | send span belongs to the trace saved in `headers` | `src/infra/messaging/outbox-relay.spec.ts:219` active trace ids during `sendBatch` `toEqual([FIRST_TRACE, SECOND_TRACE])`, `:220` one batch per trace group; `:232` no saved context → `toBeUndefined()` (does not inherit the caller's trace) | ✅ PASS |

### P1: Continuous integration

| AC | Spec-defined outcome | Evidence | Result |
| --- | --- | --- | --- |
| BOOT-22 | push touching `order-service/**`, `order-service.yml`, `_node-service.yml` runs typecheck, tests with coverage, build, Docker build | Static: `.github/workflows/order-service.yml:7-11` `push.paths` has the three paths; `:24-27` `uses: ./.github/workflows/_node-service.yml` with `service: order-service`; `.github/workflows/_node-service.yml:30` `npm run typecheck`, `:33` `npm run test:coverage -- --ci`, `:36` `npm run build`, `:46-55` `docker-build` job. `diff catalog-service.yml order-service.yml` → only name, paths, service, image name, context and cache scope differ. Live run: [40043761679](https://github.com/gabezy/arquteitura-multiplataforma-trabalho-final/actions/runs/40043761679) `ci / build-and-test` success, `ci / docker-build` success, `cd` skipped (not `main`) | ✅ PASS |
| BOOT-23 | other paths do not run the workflow | Static: `.github/workflows/order-service.yml:8-17` the `paths` filter on `push` and `pull_request` has only the three paths. Live check: the push of `10041ac` triggered only the `order-service` workflow (`gh run list --branch feature/15-bootstrap-order-service`) | ✅ PASS |
| BOOT-24 | push to `main` that passes CI pushes `ghcr.io/<owner>/omni-market-order-service` tagged SHA and `latest` | Static: `.github/workflows/order-service.yml:30` `needs: ci`, `:31` `if: push && refs/heads/main`, `:49` `IMAGE=ghcr.io/${GITHUB_REPOSITORY_OWNER,,}/omni-market-order-service`, `:56-59` `push: true`, tags `${{ github.sha }}` and `latest` | ✅ PASS (static; observable only after merge to `main`) |

### P2: Documentation

| AC | Spec-defined outcome | Evidence | Result |
| --- | --- | --- | --- |
| BOOT-25 | `order-service/CLAUDE.md` with commands, env vars, architecture, testing rules | `order-service/CLAUDE.md:13` Commands, `:41` all six env vars with defaults, `:45` Architecture, `:73` testing rules (co-location, supertest, Testcontainers `postgres:18-alpine`) | ✅ PASS (static) |
| BOOT-26 | README services table lists `order-service` (Node.js/TypeScript/Express, 8084); components table lists `order-db` (`localhost:5434`, `orders`/`orders`) and `order-service` (`http://localhost:8084`) | `README.md` diff: `\| order-service \| Node.js, TypeScript, Express \| 8084 \| …`, `\| order-db (Postgres) \| localhost:5434 \| orders / orders \|`, `\| order-service \| http://localhost:8084 \| — \|` | ✅ PASS (static) |
| BOOT-27 | root `CLAUDE.md` lists `order-service/` in the layout and `order-db` in the Postgres line | `CLAUDE.md` diff: layout line `` `order-service/` — sales orders … See `order-service/CLAUDE.md` ``; Postgres line `` `order-db` on localhost:5434 (`orders`/`orders`) `` | ✅ PASS (static) |

**Status**: ✅ All 38 ACs have `file:line` evidence. ⚠️ 2 spec-precision gaps flagged (BOOT-19, BOOT-37), both non-blocking.

---

## Edge Cases

- [x] `order-db` unreachable at container start → migration fails, exit 1: `src/infra/persistence/migrations.spec.ts:93`.
- [ ] Two instances migrating at once → only one applies: relies on Knex's built-in `knex_migrations_lock` (table present in live `\dt`). No test; accepted as library behavior.
- [x] Database back after an outage → `UP` again with no restart: `src/infra/http/health/health.routes.spec.ts:46-50`; the probe holds no state (`src/infra/persistence/database-probe.ts:10-24`). The author's smoke test also covered it.
- [x] Kafka down while running → events stay pending and are published later: `src/infra/messaging/outbox-relay.spec.ts:144-150`, `:312-313`.
- [x] Crash after send, before `published_at` → resent: the send and the update run in one transaction (`src/infra/messaging/outbox-relay.ts:68-86`), so an exception rolls the update back (`outbox-relay.spec.ts:145`). At-least-once.

---

## Discrimination Sensor

Isolated scratch: `git worktree add --detach <scratchpad>/verifier-wt HEAD`, with `order-service/node_modules` symlinked from the real tree. Each mutation was applied, the covering specs were run with `npx jest --ci`, and the file was restored with `git checkout`. The worktree was then removed with `git worktree remove --force`. Baseline in the worktree before mutating: 10 suites, 56 tests passed.

| # | File:line | Mutation | Covering specs | Killed? |
| --- | --- | --- | --- | --- |
| M1 | `src/infra/config/env.ts:26` | `port > 65535` → `port > 65536` | `env.spec.ts` "rejects PORT 65536" | ✅ Killed |
| M2 | `src/infra/config/env.ts:33` | dropped `.trim()` on brokers | `env.spec.ts` trimming | ✅ Killed |
| M3 | `src/infra/http/error-handler.ts:36` | `ConflictError` → 422 | `error-handler.spec.ts` 409 | ✅ Killed |
| M4 | `src/infra/http/error-handler.ts:21` | 4xx log record also carries `err` (raw body leak) | `error-handler.spec.ts` "does not log the request body" | ✅ Killed |
| M5 | `src/infra/http/error-handler.ts:29` | 500 response includes `err.message` as `detail` | `error-handler.spec.ts` 500 | ✅ Killed |
| M6 | `src/infra/persistence/database-probe.ts:15` | timer `PROBE_TIMEOUT_MS / 2` (message unchanged) | `database-probe.spec.ts` "still pending just before 2 s" | ✅ Killed |
| M7 | `src/infra/http/health/health.routes.ts:13` | DOWN logged at `info` instead of `warn` | `health.routes.spec.ts` 503 + level 40 | ✅ Killed |
| M8 | `src/infra/persistence/migrate.ts:15` | `process.exitCode = 1` → `0` | `migrations.spec.ts` exit code 1 | ✅ Killed |
| M9 | `src/infra/persistence/knex-outbox.repository.ts:28` | insert only the first event (`events.slice(0, 1)`) | repository + relay specs (5 failed) | ✅ Killed |
| M10 | `src/infra/persistence/knex-outbox.repository.ts:39` | `headers` stores `{}` instead of the active trace context | repository + relay trace specs | ✅ Killed |
| M11 | `src/infra/messaging/outbox-relay.ts:5` | `BATCH_SIZE` 100 → 101 | relay "at most 100 rows" | ✅ Killed |
| M12 | `src/infra/messaging/outbox-relay.ts:85` | mark all pending rows published (`whereNull`) instead of the sent ones | relay batch + concurrency (3 failed) | ✅ Killed |
| M13 | `src/infra/messaging/outbox-relay.ts:73-74` | removed `.skipLocked()` | relay "concurrent relays split" | ✅ Killed (re-run: killed) |
| M14 | `src/infra/messaging/outbox-relay.ts:130` | `ce_time` `toISOString()` → `toUTCString()` | relay CloudEvents headers | ✅ Killed |
| M15 | `src/infra/messaging/outbox-relay.ts:81` | send outside the saved trace (`withTraceHeaders(null, …)`) | relay trace context | ✅ Killed |
| M16 | `src/infra/messaging/outbox-relay.ts:49` | round not awaited (`void this.relay()`), so rounds overlap | relay "never runs two rounds" + "stop" | ✅ Killed (re-run: killed) |
| M17 | `src/infra/messaging/outbox-relay.ts:44` | `stop()` does not wait for the running round | relay "lets the round in progress finish" | ✅ Killed (re-run: killed) |
| M18 | `src/infra/messaging/outbox-relay.ts:71` | `orderBy('sequence', 'desc')` | relay order + batch (3 failed) | ✅ Killed |
| M19 | `src/infra/messaging/outbox-relay.ts:129` | `ce_subject` = `event_type` | relay CloudEvents headers | ✅ Killed (re-run ×2: killed) |
| M20 | `src/infra/persistence/migrator.ts:10` | second run logs `Applied 0 migration(s)` instead of `Database already up to date` | `migrations.spec.ts` | ✅ Killed |

**Sensor depth**: expanded (≥5, P0-style: data integrity of the outbox), across env parsing, error mapping, 4xx log redaction, probe timeout, migrator exit code, outbox repository fields, relay batch size, `published_at`, CloudEvents headers, SKIP LOCKED, loop interval and stop.
**Sensor result**: 20/20 killed - PASS ✅

**Isolation**: real tree `git status --porcelain` before = empty, after = empty (identical). `order-service/node_modules` intact. Live `order-service` still `{"status":"UP"}` afterwards. The scratch image `order-service-verifier:scratch` and the scratch container `verifier-scratch-pg` were removed.

**Static-only value (not a sensor mutant)**: `src/main.ts:9` `RELAY_INTERVAL_MS = 1000`. `main.ts` is excluded from coverage by design (matrix layer "none"), so changing it to any other value would pass every test. See observation 1.

---

## Gate Check

- **Full gate** (real tree): `cd order-service && npm run typecheck && npm run test:coverage -- --ci` → exit 0, **10 suites, 56 tests: 56 passed, 0 failed, 0 skipped**, 18 s.
- **Build gate** (scratch worktree, same commit): `npm run build` → exit 0; `docker build -t order-service-verifier:scratch .` → exit 0. The image has `User=order` and the same `CMD` as `Dockerfile:42`. The image was removed afterwards. The running stack was not rebuilt.
- **Coverage**: 81.5% statements overall. `kafka.config.ts`, `logger.ts`, `database.ts` and `migrate.ts` show 0% in-process: `migrate.ts` runs in a spawned process (`migrations.spec.ts:82`), and the others are only wired from `main.ts`.
- **Test count before feature**: 0 (new service). **After**: 56. **Delta**: +56.
- **Skipped tests**: none. **Failures**: none.

---

## CI Run (BOOT-22, BOOT-23)

**Pending push.** The branch has not been pushed because the user has not given the go-ahead, so there is no GitHub Actions run to inspect. Static check: `order-service.yml` differs from `catalog-service.yml` only in service name, paths, image name, build context and cache scope. Its `paths` filters cover `order-service/**`, itself and `_node-service.yml`, and the reusable workflow runs typecheck, `test:coverage --ci`, build and Docker build. After the push, check that the `order-service` run is green and that no other service's workflow ran for these commits, then update the T7 checkbox in tasks.md. CD (BOOT-24) can only be observed after a merge to `main`.

---

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum code (no domain, no consumers, as scoped) | ✅ |
| Surgical changes (root files only gained order-service lines) | ✅ |
| No scope creep | ✅ |
| Matches patterns (`outbox-relay.ts` identical to `catalog-service` apart from `catalog`→`order`) | ✅ |
| Spec-anchored outcome check (asserted values match spec) | ✅ (2 ⚠️ precision gaps) |
| Per-layer coverage (config every boundary; routes happy + error + recovery; persistence/messaging integration on Postgres 18) | ✅ |
| Every test maps to an AC, edge case or Done-when (migration-source spec → T3 Done-when; aggregate-root spec → T2 Done-when) | ✅ |
| Documented guidelines: none (strong defaults applied; `catalog-service` specs as the floor) | ✅ |

---

## Observations (non-blocking, ranked)

1. **BOOT-37 value only checked statically**: the 1000 ms interval lives only in `src/main.ts:9`/`:21` (composition root, layer "none"). The specs test the loop with a 200 ms parameter, so changing the constant would not fail any test. To close it, export the constant from a tested module or assert it in a small composition test.
2. **BOOT-15 literal depends on config**: `src/main.ts:26` logs `${config.serviceName} listening`, so the literal `order-service listening` holds only while `OTEL_SERVICE_NAME` keeps its default (it does in compose).
3. **BOOT-10 log shape under the preload**: with `--require instrumentation.js` (`npm start`, Docker `CMD`), `loadConfig()` throws first in `src/infra/observability/instrumentation.ts:12`. The message then comes out as an uncaught stack trace on stderr, not as a pino JSON record. Exit 1 and the message text still match the AC.
4. **BOOT-19 precision**: besides `main.ts`, clients are constructed in `instrumentation.ts:14` (`NodeSDK`, not marked), `migrate.ts:10-11` (marked `SPEC_DEVIATION`), and the helpers `kafka.config.ts:4` and `database.ts:5`, which only `main.ts`/`migrate.ts` call. This is the same pattern as `catalog-service`. Consider rewording the AC as "wired only in…".
5. **BOOT-31 multi-event row count** is checked only through the relay spec (`outbox-relay.spec.ts:84`). The repository's own happy-path test appends one event, so M9 was killed by the relay spec, not the repository spec.
6. **Timing-based test**: `outbox-relay.spec.ts:283` uses wall-clock timing. It failed once under heavy parallel load during the sensor run (unrelated mutant M19), then passed in 5/5 isolated runs and 2 reruns. Possible CI flake.
7. **Two instances migrating at once** relies on Knex's migration lock and has no test.

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| --- | --- | --- |
| BOOT-01..BOOT-21, BOOT-24..BOOT-38 | Implementing | ✅ Verified |
| BOOT-22, BOOT-23 | Implementing | ✅ Verified (static and live run) |

## Summary

**Overall**: ✅ Ready (the CI run follows the push)
**Spec-anchored check**: 38/38 ACs with evidence; 2 spec-precision gaps flagged (non-blocking)
**Sensor**: 20/20 mutations killed
**Gate**: 56 passed, 0 failed; build and Docker build exit 0
**Next steps**: push with user go-ahead, confirm the green `order-service` run and that no other workflow ran, then tick T7. Optionally address observations 1 and 4.

## Orchestrator addendum: CI after the push (2026-10-24)

The user authorized the push of `feature/15-bootstrap-order-service` after this report was written. Run [40043761679](https://github.com/gabezy/arquteitura-multiplataforma-trabalho-final/actions/runs/40043761679) on `10041ac`: `ci / build-and-test` success, `ci / docker-build` success, `cd` skipped (runs only on `main`). It was the only workflow triggered by the push, which confirms BOOT-23. BOOT-24 (image push) can only be observed after a merge to `main`.
