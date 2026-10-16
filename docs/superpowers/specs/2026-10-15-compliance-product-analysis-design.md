# compliance-service: product analysis — design

Date: 2026-10-15
Status: awaiting review

## Goal

`compliance-service` simulates compliance checks (standards, laws, restrictions) on products. When `catalog-service` creates a product, this service analyses it against a set of rules and publishes whether the product is approved or rejected. `catalog-service` already consumes that result.

Success means:

- every `catalog.product.created.v1` event produces exactly one analysis result on `produto.analisado.v1` (possibly sent more than once, never lost);
- a redelivered event is not analysed twice (processed-events table);
- traces, metrics and logs reach the shared OTel collector, and the analysis appears in the same trace as the `POST /products` that created the product.

## Decisions

| Topic | Decision |
|---|---|
| Runtime | Python 3.13 (`uv python pin 3.13`, `requires-python >=3.13`), managed with uv |
| Web | FastAPI, `GET /health` only |
| Kafka | aiokafka, manual offset commit |
| Event format | CloudEvents binary mode, both directions, via the `cloudevents` SDK Kafka binding |
| Persistence | Own Postgres (`compliance-db`), SQLAlchemy 2 async + asyncpg, Alembic migrations |
| Publishing | Publish, then commit (no outbox) |
| Rules | Chain of responsibility with blocking and non-blocking links |
| Observability | Programmatic OTel SDK, OTLP/HTTP to the collector |
| Tooling | pydantic-settings, pytest + pytest-asyncio, Testcontainers Postgres, ruff |

## Layout

The code moves to a src layout so it is importable as a package (`compliance_service`), and the FastAPI entrypoint becomes `compliance_service.main:app`.

```
compliance-service/
  pyproject.toml  uv.lock  .python-version  alembic.ini  .env.example
  src/compliance_service/
    core/                                   framework-free
      shared/domain/errors.py               DomainError, ValidationError, NotFoundError, ConflictError
      product/
        model/
          product.py                        Product value object
          violation.py                      Violation value object
          compliance_report.py              accumulates violations along the chain
          product_analysis.py               ProductAnalysis entity, AnalysisStatus
          rules/
            compliance_handler.py           chain base class
            prohibited_terms_rule.py
            price_ceiling_rule.py
            description_required_rule.py
        port/in_/analyze_product_port.py    (`in` is a keyword)
        port/out/product_analysis_repository.py
        port/out/analysis_result_publisher.py
        port/out/clock.py
        product_facade.py
    infra/
      config/settings.py                    pydantic-settings
      http/app.py                           create_app(lifespan), health route
      messaging/
        cloud_events.py                     binary-mode read/write helpers
        product_created_consumer.py         driving adapter
        kafka_analysis_result_publisher.py  driven adapter
        dead_letter.py
        inbox_store.py                      InboxStore protocol + SQLAlchemy implementation
      persistence/
        database.py                         engine + session factory
        tables.py                           SQLAlchemy table definitions
        sqlalchemy_product_analysis_repository.py
        migrations/                         Alembic env + versions
      observability/
        telemetry.py                        setup_telemetry / shutdown
        metered_analyze_product.py          metrics decorator around AnalyzeProductPort
      system_clock.py
      product_factory.py                    wires chain, facade and adapters
    main.py                                 composition root
  tests/                                    mirrors src/compliance_service/
```

## Domain (core)

### Product

Value object built from the catalog event: `product_id: str`, `sku: str`, `name: str`, `description: str`, `price: Decimal`, `stock: int`. It is not persisted. Construction validates: non-empty `product_id`, `sku` and `name`, `price >= 0`, `stock >= 0`. Otherwise it raises `InvalidProductError(ValidationError)`.

### Violation and ComplianceReport

- `Violation(rule_code: str, message: str)`, frozen.
- `ComplianceReport` holds the violations recorded so far (`add`, `violations`, `has_violations`).

### Rule chain

```python
class ComplianceHandler(ABC):
    code: str
    blocking: bool = False

    def __init__(self, next_handler: ComplianceHandler | None = None) -> None: ...

    def handle(self, product: Product, report: ComplianceReport) -> ComplianceReport:
        violation = self._check(product)
        if violation:
            report.add(violation)
            if self.blocking:
                return report
        return self._next.handle(product, report) if self._next else report

    @abstractmethod
    def _check(self, product: Product) -> Violation | None: ...
```

Initial rules, in chain order:

1. `ProhibitedTermsRule` (`PROHIBITED_TERMS`, **blocking**): name or description contains a banned term. Matching is case- and accent-insensitive (NFKD normalisation) on whole words. Terms come from the constructor; the default list covers weapons, drugs, counterfeit goods and controlled medicines (Portuguese and English).
2. `PriceCeilingRule` (`PRICE_CEILING`): `price > ceiling` (constructor, default `100000`).
3. `DescriptionRequiredRule` (`DESCRIPTION_REQUIRED`): stripped description shorter than `min_length` (constructor, default `20`).

The chain is assembled in `infra/product_factory.py`. Adding or reordering a rule does not touch the facade.

### ProductAnalysis

Entity with `id: UUID`, `product_id`, `sku`, `status: AnalysisStatus` (`APPROVED` | `REJECTED`), `violations: tuple[Violation, ...]` and `analyzed_at: datetime` (UTC). `ProductAnalysis.of(product, report, now)` sets `APPROVED` when the report is empty and `REJECTED` otherwise.

### Ports

- `port/in_`: `AnalyzeProductPort.analyze(product: Product) -> ProductAnalysis`.
- `port/out`: `ProductAnalysisRepository.save(analysis)`, `AnalysisResultPublisher.publish(analysis)`, `Clock.now()`.

All ports are `typing.Protocol` classes with async methods (except `Clock`).

### ProductFacade

Implements `AnalyzeProductPort` and receives the chain head, the repository, the publisher and the clock through `__init__`. `analyze`:

1. `report = chain.handle(product, ComplianceReport())`
2. `analysis = ProductAnalysis.of(product, report, clock.now())`
3. `await publisher.publish(analysis)`
4. `await repository.save(analysis)`
5. return `analysis`

The facade knows nothing about event ids, offsets or transactions.

### Errors

`core/shared/domain/errors.py` defines `DomainError` and the categories `ValidationError`, `NotFoundError` and `ConflictError`. Concrete errors extend a category. Core never raises a bare `Exception`.

## Messaging (infra)

### CloudEvents binary mode

Done in `infra/messaging/cloud_events.py` with `cloudevents.kafka` (`from_binary`, `to_binary`).

Reading `catalog.product.created.v1`:

- `ce_id`, `ce_type`, `ce_source` and `ce_subject` come from headers, and the value is the JSON data `{productId, sku, name, description, price, stock}`.
- The data is validated with a pydantic model and translated to `Product` (anticorruption layer).
- A missing `ce_*` header, a `ce_type` other than `catalog.product.created.v1`, invalid JSON or invalid data makes the message unprocessable.

Publishing `produto.analisado.v1`:

- The key is `product_id`.
- Headers: `ce_specversion=1.0`, `ce_id=<uuid4>`, `ce_source=compliance-service`, `ce_type=produto.analisado.v1`, `ce_subject=<product_id>`, `ce_time=<analyzed_at ISO-8601>`, `content-type=application/json`.
- The value is `{"sku": ..., "status": "APPROVED"|"REJECTED", "violations": [{"ruleCode": ..., "message": ...}]}`.
- `catalog-service` validates `sku` and `status` with a non-strict zod object, so `violations` is ignored there.
- `KafkaAnalysisResultPublisher.publish` awaits `send_and_wait`, so it returns only after the broker acknowledges.

### Consumer flow

`ProductCreatedConsumer` runs as an asyncio task started and stopped in the FastAPI lifespan. It uses group id `compliance-service`, `auto_offset_reset="earliest"` and `enable_auto_commit=False`, and subscribes to `PRODUCT_CREATED_TOPIC`.

Per message:

1. Extract `traceparent` from the headers and open a `catalog.product.created.v1 process` span (kind CONSUMER) in that context. The steps below run inside it.
2. Parse the CloudEvent and translate it to `Product` (unprocessable messages go to the DLQ, step 7).
3. Open an `AsyncSession` and begin a transaction.
4. If `inbox_store.was_processed(ce_id)`, skip to commit (no analysis, no publish).
5. Build the facade bound to this session (`product_factory.build_analyze_product(session)`) and call `analyze(product)`.
6. `inbox_store.mark_processed(ce_id, ce_type)`, commit, then commit the Kafka offset.
7. Error handling:
   - Unprocessable message or `DomainError`: send it to the DLQ, increment `compliance.messages.dead_lettered`, commit the offset.
   - Any other exception: roll back, log, `seek` the partition back to the message offset, and retry after an exponential backoff (1s, doubling, capped at 30s; it resets after a success).

Guarantees:

- A crash after the publish but before the commit leads to redelivery and the same analysis being republished, because the rules are deterministic. `catalog-service` treats a repeated identical result as a no-op.
- Two consumers racing on one event: the primary key on `processed_events.event_id` makes the second commit fail. It is retried, and the retry finds the row and skips.

### Dead letter topic

`compliance.product-created.dlq`, 1 partition, `retention.ms=1209600000` (14 days), added to `docker/kafka/create-topics.sh`. Each record keeps the original key, value and headers and adds `dlq-original-topic`, `dlq-original-partition`, `dlq-original-offset` and `dlq-reason`.

### InboxStore

Protocol with `was_processed(event_id) -> bool` and `mark_processed(event_id, event_type)`, plus a SQLAlchemy implementation that uses the message's session. It lives in `infra` because deduplication is a messaging concern, not a domain rule.

## Persistence

Alembic, with migrations in `src/compliance_service/infra/persistence/migrations/` and `alembic.ini` at the service root. The migration env reads `DATABASE_URL` from the settings.

```
product_analyses
  id           uuid         primary key
  product_id   text         not null
  sku          text         not null
  status       text         not null  check (status in ('APPROVED','REJECTED'))
  violations   jsonb        not null  default '[]'
  analyzed_at  timestamptz  not null
  index on sku

processed_events
  event_id     text         primary key
  event_type   text         not null
  processed_at timestamptz  not null
```

`compose.yaml` gets `compliance-db`: postgres:18-alpine, host port `5433`, db/user/password `compliance` (overridable via `COMPLIANCE_DB_*`), a `pg_isready` healthcheck and a `compliance-db-data` volume.

## HTTP

`create_app(lifespan)` builds the FastAPI app. `GET /health` returns `200 {"status": "UP"}`. The lifespan opens the engine, the producer and the consumer task, and closes them in reverse order.

## Observability

`infra/observability/telemetry.py`:

- `setup_telemetry(settings)` is called by `main.py` before the app is built. It configures the resource `service.name=<OTEL_SERVICE_NAME>` and sets up OTLP/HTTP exporters to `<OTEL_COLLECTOR_URL>/v1/{traces,metrics,logs}`: a `BatchSpanProcessor`, a `PeriodicExportingMetricReader`, and a `BatchLogRecordProcessor` with a `LoggingHandler` attached to the root logger.
- Instrumentations: FastAPI, SQLAlchemy (engine), aiokafka (the producer injects `traceparent` into published messages), and logging (`trace_id`/`span_id` in the record format).
- `shutdown_telemetry()` flushes and shuts down the providers in the lifespan teardown.
- Tests never call `setup_telemetry`, so the OTel API stays a no-op there.

Logging: standard `logging`, a console handler plus the OTLP handler, with the level from `LOG_LEVEL`. Loggers are obtained only in `infra` (`logging.getLogger(__name__)`).

Custom metrics, all recorded in `infra`:

| Metric | Type | Attributes | Where |
|---|---|---|---|
| `compliance.analyses` | counter | `status` | `MeteredAnalyzeProduct` |
| `compliance.rule.violations` | counter | `rule_code` | `MeteredAnalyzeProduct` |
| `compliance.analysis.duration` | histogram (s) | — | `MeteredAnalyzeProduct` |
| `compliance.messages.dead_lettered` | counter | `reason` | consumer |

`MeteredAnalyzeProduct` implements `AnalyzeProductPort` and wraps the facade (decorator), so core has no OTel import.

## Configuration

`infra/config/settings.py` (pydantic-settings, reads `.env` if present). `.env.example`:

```
PORT=8083
LOG_LEVEL=INFO
OTEL_SERVICE_NAME=compliance-service
OTEL_COLLECTOR_URL=http://localhost:4318
DATABASE_URL=postgresql+asyncpg://compliance:compliance@localhost:5433/compliance
KAFKA_BROKERS=localhost:9092
PRODUCT_CREATED_TOPIC=catalog.product.created.v1
PRODUTO_ANALISADO_TOPIC=produto.analisado.v1
PRODUCT_CREATED_DLQ_TOPIC=compliance.product-created.dlq
PRICE_CEILING=100000
DESCRIPTION_MIN_LENGTH=20
```

## Testing

pytest + pytest-asyncio (`asyncio_mode = "auto"`), with tests in `tests/` mirroring `src/compliance_service/`.

- Unit tests:
  - `Product` validation, `ProductAnalysis.of`
  - each rule (including accent/case handling)
  - the chain: order, a blocking link stopping the chain, non-blocking links accumulating violations
  - the facade with fakes: verifies publish-before-save and the returned analysis
- `MeteredAnalyzeProduct`: delegates to the wrapped port and returns its result.
- CloudEvents helpers: round-trip, missing headers, wrong `ce_type`.
- Consumer tests, with a fake `AnalyzeProductPort`, a fake producer and an in-memory `InboxStore`. Messages are fed directly to the per-message handler, not through a broker. Cases: happy path, duplicate skipped, invalid message to the DLQ, `DomainError` to the DLQ, transient error leading to a seek-back without an offset commit.
- Persistence tests: Testcontainers `postgres:18-alpine` and `alembic upgrade head`. They cover saving and reading an analysis, `mark_processed`/`was_processed`, a duplicate `event_id` failing the commit, and rollback leaving no analysis row. Docker is required.
- HTTP: `/health` via `httpx.AsyncClient` with `ASGITransport`.

ruff handles lint and format (`uv run ruff check`, `uv run ruff format`).

## Documentation

- Update `compliance-service/CLAUDE.md`: Python 3.13, commands (sync, dev, test, single test, lint, migrations), the flow, the conventions.
- Update the root `CLAUDE.md`: the `compliance-db` port.

## Out of scope

- Dockerfile and CI pipeline for this service.
- HTTP endpoints for analyses.
- Transactional outbox.
- Reanalysis when a product changes (`catalog` publishes no update event yet).
