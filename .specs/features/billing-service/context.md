# billing-service Context

**Gathered:** 2026-10-24
**Spec:** `.specs/features/billing-service/spec.md`
**Status:** Ready for design

---

## Feature Boundary

The billing-service turns every `order.order.confirmed.v1` into one invoice with the Omni Market commission of its marketplace, charges the invoice at a simulated PSP, publishes the outcome for the order-service, and exposes the invoices to the BFF. It covers issues #11, #16, #23 and #32.

---

## Implementation Decisions

### Language

- The user asked for a language the project does not use yet, because the course is about multiplatform architecture, "only if it makes sense" (2026-10-24). Go makes sense here: static binaries for any OS and architecture, integer money, goroutines for the background workers and a small image. ADR-0006 records it.

### What is charged

- The confirmed order total is charged through the PSP (user choice, 2026-10-24).
- The invoice records the Omni Market commission, with a rate per marketplace chosen by a Strategy, and the net amount due to the store.
- A refused payment publishes `billing.payment.failed.v1`, and the order-service cancels the order (ADR-0004).

### PSP simulator

- Billing ships the WireMock mappings of the PSP (approved, refused, status query) even though #26 belongs to José Ricardo (user choice, 2026-10-24). The pull request of #32 mentions #26 so he can review or extend them.

### Agent's Discretion

Everything below the three decisions above: contracts, rates, thresholds, resilience parameters, API shape and project layout. Each choice is logged in the spec's Assumptions table.

### Declined / Undiscussed Gray Areas → Assumptions

- Contract of `order.order.confirmed.v1` and marketplace values: defined in the event catalog of #8 (PR #52), to be accepted by the order-service owner (#20).
- Commission rates, rounding, PSP refusal threshold and resilience parameters: simulation values, overridable by environment variables where they matter.
- Cancellation ordering (cancel before confirm) and cancellation of a paid invoice: handled as in the spec's Assumptions table.

---

## Specific References

- ADR-0004 (catalog owns the stock, choreography): defines the trigger and the reaction to a refused payment.
- `catalog-service` and `order-service`: outbox table shape, relay with `SKIP LOCKED`, CloudEvents `ce_*` headers, `dlq-*` headers, health check with database probe.
- `compliance-service`: inbox (`processed_events`), dead letter for messages that can never succeed, retry in place with backoff from 1 s to 30 s.
- `docs/demo-estoque.md`: style of the manual demo script with `kafka-console-producer`.

---

## Deferred Ideas

- Refund of a paid invoice whose order is cancelled later.
- Payout of the net amount to the store (split execution at the PSP).
- Cleanup job for published outbox rows.
