# LESSONS - auto-maintained by scripts/lessons.py

> Machine-owned. Do NOT hand-edit. Changes are overwritten on the next `lessons.py` write.
> Canonical state lives in `.specs/lessons.json`. Edit lessons only via the script.
> promote_threshold=2 distinct features · window_days=45 · quarantine_threshold=2

## Confirmed (load these at Specify/Design)

Corroborated across multiple features. Safe to apply as guidance.

_none_

## Candidates (under observation - do NOT load as guidance yet)

Seen once or not yet corroborated. Tracked, not trusted.

### L-001 - For every check an end-to-end script makes, the scenario harness must include a fault that makes that check fail, or the check can be deleted unnoticed
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `e2e` · harmful: 0
- features: e2e-smoke
- evidence: scripts/e2e-smoke.sh:83 (M1, E2E-06) (e2e) (+1 more)
- last seen: 2026-10-24T16:43:01Z

### L-002 - When an acceptance criterion requires two outcomes of one step, assert each outcome separately so that removing either one fails a test
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `e2e` · harmful: 0
- features: e2e-smoke
- evidence: scripts/e2e-smoke.sh:119-120 (M2, E2E-09) (e2e)
- last seen: 2026-10-24T16:03:49Z

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
