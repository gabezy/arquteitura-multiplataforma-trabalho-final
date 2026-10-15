# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`compliance-service` is one service in the "omni-market" monorepo. It simulates compliance checks (standards, laws, restrictions) on products: it consumes `catalog.product.created.v1`, runs the product through a chain of rules, and publishes `APPROVED`/`REJECTED` to `produto.analisado.v1`, which `catalog-service` consumes.

Shared infrastructure and monorepo-wide conventions are described in `../CLAUDE.md`. `../catalog-service/CLAUDE.md` is the reference implementation of the same architecture in TypeScript. The design is in `../docs/superpowers/specs/2026-10-15-compliance-product-analysis-design.md`.

Stack: Python 3.13 (pinned in `.python-version`), uv, FastAPI, aiokafka, cloudevents, SQLAlchemy 2.0 async + asyncpg, Alembic, pydantic-settings, OpenTelemetry.

SQLAlchemy is pinned to `<2.1` because `opentelemetry-instrumentation-sqlalchemy` does not support 2.1 yet. An out-of-range library makes its instrumentor do nothing, without failing; `tests/infra/observability/test_telemetry.py` catches that.

## Commands

Run from this directory:

```bash
docker compose -f ../compose.yaml up -d compliance-db kafka kafka-init   # add --profile obs for the collector and Grafana
uv sync                                   # install into .venv
uv run alembic upgrade head               # apply migrations
uv run python -m compliance_service.main  # run on PORT (8083)
uv run fastapi dev --port 8083            # dev server with reload
uv run pytest                             # all tests (Docker must be running: persistence tests use Testcontainers)
uv run pytest tests/core                  # domain only, no Docker
uv run pytest tests/core/product/model/rules/test_rules.py::TestPriceCeilingRule   # one class
uv run pytest -k "dead_letter"            # tests matching a name
uv run ruff check && uv run ruff format   # lint and format
uv run alembic revision -m "add x"        # new migration in src/compliance_service/infra/persistence/migrations/versions/
```

Config comes from env vars (see `.env.example`; `.env` is loaded if present): `PORT`, `LOG_LEVEL`, `OTEL_SERVICE_NAME`, `OTEL_COLLECTOR_URL`, `DATABASE_URL` (`compliance-db` on localhost:5433), `KAFKA_BROKERS`, `PRODUCT_CREATED_TOPIC`, `PRODUTO_ANALISADO_TOPIC`, `PRODUCT_CREATED_DLQ_TOPIC`, `PRICE_CEILING`, `DESCRIPTION_MIN_LENGTH`.

## Architecture: Hexagonal (Ports and Adapters)

```
src/compliance_service/
  core/                         framework-free: no FastAPI, aiokafka, SQLAlchemy, cloudevents, pydantic or OpenTelemetry
    shared/domain/errors.py     DomainError → ValidationError | NotFoundError | ConflictError
    product/model/              Product (value object), Violation, ComplianceReport, ProductAnalysis
    product/model/rules/        the rule chain
    product/port/in_/           driving ports (`in` is a keyword)
    product/port/out/           repository, publisher, clock
    product/product_facade.py   runs the chain, publishes, then saves
  infra/                        adapters grouped by technology: config/, http/, messaging/, persistence/, observability/
    product_factory.py          builds the rule chain and the per-message unit of work
  main.py                       composition root: settings, telemetry, Kafka, DB, FastAPI lifespan
tests/                          mirrors src/compliance_service/
```

- Dependencies point inward only. Ports are `typing.Protocol`s; the facade receives its `port/out` dependencies through `__init__`.
- Core raises `DomainError` subclasses, never a bare `Exception`. A product-specific error lives next to the model (`product_errors.py`).
- Unit-test the core with in-memory fakes of the ports. Test adapters at their boundary: persistence against Testcontainers Postgres (fixtures in `tests/conftest.py`), messaging with the fake producer and records in `tests/infra/messaging/conftest.py`.
- pytest runs with `--import-mode=importlib`; test directories have no `__init__.py`, and shared helpers are fixtures, not imports.

### Rule chain

Rules are a chain of responsibility (`core/product/model/rules/compliance_handler.py`). Each `ComplianceHandler` has a `code`, checks one thing in `_check`, and records a `Violation`. A `blocking` handler that finds a violation ends the chain; non-blocking handlers accumulate. The order is set in `infra/product_factory.build_rules`: `ProhibitedTermsRule` (blocking) → `PriceCeilingRule` → `DescriptionRequiredRule`. A new rule is a new handler plus a line in `build_rules`; the facade does not change. Rules must stay deterministic, because redelivery republishes the same result.

## Messaging (Kafka)

- Both directions use CloudEvents binary mode (`infra/messaging/cloud_events.py`, `cloudevents.core.bindings.kafka`): attributes go in `ce_*` headers, and the value is the JSON data. The catalog contract is translated there, so its vocabulary stays out of the core.
- Output on `produto.analisado.v1`: key = product id, value `{"sku", "status", "violations": [{"ruleCode", "message"}]}`. `catalog-service` validates `sku` and `status`.
- Per message (`infra/messaging/product_created_consumer.py`), inside one DB transaction (the unit of work):
  1. skip if `processed_events` already has `ce_id`
  2. otherwise analyse, publish (awaiting the ack), then save the analysis
  3. mark the event processed and commit
  4. commit the Kafka offset

  A crash between the publish and the commit republishes the same result, which catalog ignores.
- A message that can never succeed (`UnprocessableMessageError` or a `DomainError`) goes to `compliance.product-created.dlq` with `dlq-*` headers. Anything else is retried in place with backoff (1s doubling, capped at 30s), and the offset is not committed until it succeeds.
- A new topic goes in `../docker/kafka/create-topics.sh`.

## Observability

- `infra/observability/telemetry.setup_telemetry` runs at import time of `main.py`, before the app is built. It sets up OTLP/HTTP exporters to `OTEL_COLLECTOR_URL` for traces, metrics and logs, and instruments aiokafka, FastAPI, SQLAlchemy and logging. Tests never call it, so the OTel API is a no-op there.
- The consumer extracts `traceparent` from the message and opens a `<topic> process` CONSUMER span, so the analysis joins the catalog trace. The aiokafka instrumentation injects `traceparent` into published messages.
- Logs: use `logging.getLogger(__name__)` in `infra` only. Records carry `otelTraceID`/`otelSpanID` and go to the console and to the collector.
- Custom metrics live in `infra` only: `MeteredAnalyzeProduct` (a decorator around `AnalyzeProductPort`) records `compliance.analyses`, `compliance.rule.violations` and `compliance.analysis.duration`; the consumer records `compliance.messages.dead_lettered`. Metrics are exported every 60s.
