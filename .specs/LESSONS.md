# LESSONS - auto-maintained by scripts/lessons.py

> Machine-owned. Do NOT hand-edit. Changes are overwritten on the next `lessons.py` write.
> Canonical state lives in `.specs/lessons.json`. Edit lessons only via the script.
> promote_threshold=2 distinct features · window_days=45 · quarantine_threshold=2

## Confirmed (load these at Specify/Design)

Corroborated across multiple features. Safe to apply as guidance.

### L-015 - Give every clause of a compound acceptance criterion its own asserting test.
- signal: `ac_gap` · recurrence: 2 feature(s) · scope: `acceptance-tests` · harmful: 0
- features: billing-service, e2e-smoke
- evidence: BOOT-06: .specs/features/billing-service/spec.md:96 (clauses of the shutdown criterion without a test) (acceptance-tests) (+1 more)
- last seen: 2026-10-24T17:39:02Z

## Candidates (under observation - do NOT load as guidance yet)

Seen once or not yet corroborated. Tracked, not trusted.

### L-001 - Assert a Kafka consumer's offset commits against a real consumer group client: advanced after success or dead letter, untouched after a failure.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `kafka-consumer` · harmful: 0
- features: billing-service
- evidence: M27, M28: billing-service/internal/infra/messaging/consumer.go:73-79 (INV-06, INV-07) (kafka-consumer)
- last seen: 2026-10-24T08:14:15Z

### L-002 - Cover the composition root so that dropping or mis-wiring any background worker fails a test.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `composition-root` · harmful: 0
- features: billing-service
- evidence: M78, M82: billing-service/internal/app/app.go:93,114 (REC-01) (composition-root)
- last seen: 2026-10-24T08:14:15Z

### L-003 - Expose every time window and interval of a background worker as configuration so an end-to-end test can shorten it.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `worker` · harmful: 0
- features: billing-service
- evidence: M83: billing-service/internal/app/app.go:76 (REC-01) (worker)
- last seen: 2026-10-24T08:14:15Z

### L-004 - Test a strict time boundary with a row exactly at the cutoff.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `persistence` · harmful: 0
- features: billing-service
- evidence: M48: billing-service/internal/infra/persistence/invoice_repository.go:169 (REC-01) (persistence)
- last seen: 2026-10-24T08:14:15Z

### L-005 - Keep end-to-end wait timeouts close to the expected latency so a mis-wired interval fails the test.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `e2e-tests` · harmful: 0
- features: billing-service
- evidence: M81: billing-service/internal/app/app.go:92 (PAY-01) (e2e-tests)
- last seen: 2026-10-24T08:14:15Z

### L-006 - Assert the log level that a spec decision names, such as a warning, in a test of the code that logs it.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `logging` · harmful: 0
- features: billing-service
- evidence: INV-11: .specs/features/billing-service/spec.md:56 (warning logged for a paid invoice) (logging)
- last seen: 2026-10-24T08:14:15Z

### L-007 - Name every required CloudEvents header in the spec instead of saying a required header.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `spec` · harmful: 0
- features: billing-service
- evidence: INV-06: .specs/features/billing-service/spec.md:119 (spec)
- last seen: 2026-10-24T08:14:15Z

### L-008 - State in the spec whether a retry delay formula counts the failure being scheduled.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `spec` · harmful: 0
- features: billing-service
- evidence: PAY-10: .specs/features/billing-service/spec.md:164 (spec)
- last seen: 2026-10-24T08:14:15Z

### L-009 - Define in the spec which work in progress a graceful shutdown must finish.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `spec` · harmful: 0
- features: billing-service
- evidence: BOOT-06: .specs/features/billing-service/spec.md:96 (spec)
- last seen: 2026-10-24T08:14:15Z

### L-010 - Give each rejection branch of a message parser its own malformed input in the test table, including a missing field and data after the JSON value.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `message-parser` · harmful: 0
- features: billing-service
- evidence: F6, F7: billing-service/internal/infra/messaging/order_events.go:125,182 (INV-06) (message-parser)
- last seen: 2026-10-24T09:34:31Z

### L-011 - Assert the wait actually applied between retry attempts, not only the configured delays.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `retry` · harmful: 0
- features: billing-service
- evidence: J12: billing-service/internal/infra/psp/client.go:228 (PAY-09) (retry)
- last seen: 2026-10-24T09:34:31Z

### L-012 - Cover the composition root so that mis-wiring a configured adapter, such as a retry policy or a health probe, fails a test.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `composition-root` · harmful: 0
- features: billing-service
- evidence: L8, L9: billing-service/internal/app/app.go:74,96 (PAY-09, BOOT-02) (composition-root)
- last seen: 2026-10-24T09:34:31Z

### L-013 - Test a health check client against an unhealthy answer, not only against a healthy service and a stopped one.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `healthcheck` · harmful: 0
- features: billing-service
- evidence: S3: billing-service/cmd/billing-service/main.go:88 (BOOT-07) (healthcheck)
- last seen: 2026-10-24T09:34:31Z

### L-014 - Test a graceful shutdown with a request that never finishes and assert the process still exits inside its time budget.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `shutdown` · harmful: 0
- features: billing-service
- evidence: S1, S2: billing-service/internal/app/app.go:30,49,119 (BOOT-06) (shutdown)
- last seen: 2026-10-24T09:34:31Z

### L-016 - State in the spec what a graceful shutdown does with the unsent rest of a batch.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `spec` · harmful: 0
- features: billing-service
- evidence: BOOT-06: .specs/features/billing-service/spec.md:96 (finish the outbox batch) (spec)
- last seen: 2026-10-24T09:34:31Z

### L-017 - Name the required fields of a request body in the spec instead of saying a field.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `spec` · harmful: 0
- features: billing-service
- evidence: Edge case webhook body: .specs/features/billing-service/spec.md:193 (misses a field) (spec)
- last seen: 2026-10-24T09:34:31Z

### L-018 - Assert a time budget that the spec states in seconds with its absolute value, not through the constant under test.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `shutdown` · harmful: 0
- features: billing-service
- evidence: B17: billing-service/internal/app/app.go:31 (BOOT-06) (shutdown)
- last seen: 2026-10-24T10:20:16Z

### L-019 - Test that a batch loop stops at the next item after cancellation with a collaborator that ignores its context.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `outbox-relay` · harmful: 0
- features: billing-service
- evidence: B09: billing-service/internal/infra/outbox/relay.go:130 (BOOT-06) (outbox-relay)
- last seen: 2026-10-24T10:20:16Z

### L-020 - Assert the period of a ticker-driven loop from below and from above, not only that it runs several times.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `worker` · harmful: 0
- features: billing-service
- evidence: B20: billing-service/internal/infra/worker/worker.go:18 (REC-01) (worker)
- last seen: 2026-10-24T10:20:16Z

### L-021 - Assert the resource attribute of each exported telemetry signal separately, because another field such as the scope name can satisfy a substring check.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `observability` · harmful: 0
- features: billing-service
- evidence: C04: billing-service/internal/infra/observability/telemetry.go:78 (BOOT-05) (observability)
- last seen: 2026-10-24T10:20:16Z

### L-022 - For every check an end-to-end script makes, the scenario harness must include a fault that makes that check fail, or the check can be deleted unnoticed
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `e2e` · harmful: 0
- features: e2e-smoke
- evidence: scripts/e2e-smoke.sh:83 (M1, E2E-06) (e2e) (+1 more)
- last seen: 2026-10-24T17:39:02Z

### L-023 - When a required step is a no-op on an already prepared environment, the harness needs a scenario that starts from an unprepared state, or the spec must declare the step verified by inspection
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `e2e` · harmful: 0
- features: e2e-smoke
- evidence: scripts/e2e-smoke.sh:71 (MB, E2E-02, post-merge) (e2e)
- last seen: 2026-10-24T18:34:05Z

### L-024 - Build run-unique ids with fixed-width formatting; never slice a variable-length random suffix or pass zero-padded digits to printf %d
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `e2e` · harmful: 0
- features: e2e-smoke
- evidence: scripts/e2e-smoke.sh:22,29-32 (E2E-15, v2) (e2e)
- last seen: 2026-10-25T15:42:54Z

### L-025 - A resilience behavior declared only in Assumptions, such as a retry, needs one harness check or an explicit verified-by-inspection note in the spec
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `e2e` · harmful: 0
- features: e2e-smoke
- evidence: scripts/e2e-smoke.sh:125 (N7, v2) (e2e)
- last seen: 2026-10-25T15:42:54Z

### L-026 - When a harness checks a retry or timeout, count the attempts in the output instead of asserting on wall-clock time
- signal: `gate_fail` · recurrence: 1 feature(s) · scope: `e2e` · harmful: 0
- features: e2e-smoke
- evidence: scripts/e2e-smoke.test.sh:127 (retry check failed 3/3 alone on unmodified code: 32, 37, 37 s) (e2e)
- last seen: 2026-10-25T16:20:46Z

### L-027 - When a test counts attempts from log lines, log every attempt including the last so the count pins the number of attempts
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `e2e` · harmful: 0
- features: e2e-smoke
- evidence: scripts/e2e-smoke.sh:122 (N10, v2-3: 4 attempts print the same 4 lines as 5) (e2e)
- last seen: 2026-10-25T16:44:17Z

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
