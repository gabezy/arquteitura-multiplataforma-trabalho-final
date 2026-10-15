# compliance-service Product Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `compliance-service` consumes `catalog.product.created.v1`, analyses each product with a chain of compliance rules, publishes the result to `produto.analisado.v1` (CloudEvents binary mode), stores each analysis and each processed event in Postgres, and exports traces, metrics and logs over OTLP.

**Architecture:** Hexagonal. `core/` (framework-free) holds the `Product` value object, the rule chain (chain of responsibility with blocking links), the `ProductAnalysis` entity, the ports and `ProductFacade`. `infra/` holds the adapters: an aiokafka consumer (the driving adapter), the Kafka publisher and DLQ, SQLAlchemy repositories, the processed-events inbox, the OTel setup and the metrics decorator. `main.py` wires everything up in the FastAPI lifespan.

**Tech Stack:** Python 3.13, uv, FastAPI, aiokafka, cloudevents 2.x (`cloudevents.core.bindings.kafka`), SQLAlchemy 2 async + asyncpg, Alembic, pydantic-settings, OpenTelemetry SDK 1.45 / instrumentation 0.66b1, pytest + pytest-asyncio, testcontainers, ruff.

**Spec:** `docs/superpowers/specs/2026-10-15-compliance-product-analysis-design.md`

## Global Constraints

- Run every command from `compliance-service/` unless a step says otherwise. If your shell exports `VIRTUAL_ENV` for another project, `unset VIRTUAL_ENV` first.
- Python `requires-python = ">=3.13"`; pin with `uv python pin 3.13`.
- Package: `src/compliance_service/` (uv_build src layout); FastAPI entrypoint `compliance_service.main:app`.
- `core/` never imports FastAPI, aiokafka, SQLAlchemy, cloudevents, pydantic, OpenTelemetry or anything in `infra/`.
- Core raises `DomainError` subclasses (`ValidationError`, `NotFoundError`, `ConflictError`), never a bare `Exception`.
- Driving port package is `port/in_` (`in` is a Python keyword).
- Incoming type `catalog.product.created.v1`; outgoing type `produto.analisado.v1`, `ce_source=compliance-service`, key = product id, value `{"sku", "status": "APPROVED"|"REJECTED", "violations": [{"ruleCode", "message"}]}`.
- DLQ topic `compliance.product-created.dlq` (1 partition, `retention.ms=1209600000`); DLQ headers `dlq-original-topic`, `dlq-original-partition`, `dlq-original-offset`, `dlq-reason`.
- Consumer group `compliance-service`, `auto_offset_reset="earliest"`, `enable_auto_commit=False`.
- Publish, then commit: the facade publishes (awaiting the broker ack) before the repository saves; the DB transaction commits before the Kafka offset.
- Retry backoff: 1s, doubling, capped at 30s, reset per message. **Refinement of the spec:** a transient failure retries the same record in place (no `getone` until it succeeds) instead of `seek`. The guarantee is identical (the offset is not committed until success).
- **Refinement of the spec:** a duplicate `processed_events.event_id` fails at the `INSERT` (not only at commit). Both paths raise `IntegrityError`, which the consumer retries; the retry sees the row and skips.
- Rule chain order: `ProhibitedTermsRule` (blocking) → `PriceCeilingRule` (default `100000`) → `DescriptionRequiredRule` (default `20`).
- `compliance-db`: postgres:18-alpine, host port `5433`, db/user/password `compliance`.
- Default `PORT=8083`.
- Commit messages: Conventional Commits in Portuguese, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Docker must be running for the persistence tests (Testcontainers).

## Review Focus

1. Catalog sends `price` as a JSON number (`19.99`); it must become `Decimal("19.99")` exactly, not a binary-float artifact. Task 7 pins it.
2. Kafka allows header values to be `null`; such a header must be ignored, not crash parsing or dead-lettering. Tasks 7 and 8 pin it.
3. A product with an empty description is a valid catalog product; it must be analysed and `REJECTED` by `DESCRIPTION_REQUIRED`, never dead-lettered. Tasks 2 and 7 pin it.
4. A banned term inside another word ("crackers" vs "crack") must not be flagged, while upper-case or accented spellings ("MUNIÇÃO") must be. Task 3 pins it.
5. A redelivered event (the DB was committed, the offset was not) must be skipped without republishing, and the consumer span must join the catalog trace through `traceparent`. Task 8 pins both.

---

## File Map

```
compliance-service/
  pyproject.toml  .python-version  .gitignore  alembic.ini  .env.example  CLAUDE.md
  src/compliance_service/
    __init__.py  main.py
    core/__init__.py
    core/shared/__init__.py  core/shared/domain/__init__.py  core/shared/domain/errors.py
    core/product/__init__.py  core/product/product_facade.py
    core/product/model/__init__.py  product.py  product_errors.py  violation.py  compliance_report.py  product_analysis.py
    core/product/model/rules/__init__.py  compliance_handler.py  prohibited_terms_rule.py  price_ceiling_rule.py  description_required_rule.py
    core/product/port/__init__.py
    core/product/port/in_/__init__.py  analyze_product_port.py
    core/product/port/out/__init__.py  product_analysis_repository.py  analysis_result_publisher.py  clock.py
    infra/__init__.py  system_clock.py  product_factory.py
    infra/config/__init__.py  settings.py
    infra/http/__init__.py  app.py  health.py
    infra/messaging/__init__.py  kafka_record.py  message_producer.py  cloud_events.py
                     kafka_analysis_result_publisher.py  dead_letter.py  inbox_store.py  unit_of_work.py
                     product_created_consumer.py
    infra/persistence/__init__.py  database.py  tables.py  sqlalchemy_product_analysis_repository.py  sqlalchemy_unit_of_work.py
    infra/persistence/migrations/env.py  script.py.mako  versions/0001_create_product_analyses_and_processed_events.py
    infra/observability/__init__.py  telemetry.py  metered_analyze_product.py
  tests/
    conftest.py
    core/product/model/test_product.py  test_product_analysis.py
    core/product/model/rules/test_compliance_handler.py  test_rules.py
    core/product/test_product_facade.py
    infra/config/test_settings.py
    infra/http/test_health.py
    infra/persistence/test_migrations.py  test_sqlalchemy_product_analysis_repository.py
    infra/messaging/conftest.py  test_inbox_store.py  test_cloud_events.py  test_kafka_analysis_result_publisher.py
                     test_dead_letter.py  test_product_created_consumer.py
    infra/observability/test_metered_analyze_product.py
    infra/test_product_factory.py
repo root: compose.yaml (compliance-db), docker/kafka/create-topics.sh (DLQ), CLAUDE.md
```

Every new directory under `src/compliance_service/` gets an empty `__init__.py`. Test directories do **not** (pytest runs with `--import-mode=importlib`).

---

### Task 1: Project setup and health endpoint

**Files:**
- Modify: `compliance-service/pyproject.toml` (full rewrite)
- Create: `compliance-service/.python-version` (via `uv python pin`), `compliance-service/.gitignore`
- Delete: `compliance-service/src/__init__.py`, `compliance-service/src/main.py`
- Create: `src/compliance_service/__init__.py`, `src/compliance_service/infra/__init__.py`, `src/compliance_service/infra/http/__init__.py`, `src/compliance_service/infra/http/health.py`, `src/compliance_service/infra/http/app.py`, `src/compliance_service/main.py`
- Test: `tests/infra/http/test_health.py`

**Interfaces:**
- Produces: `create_app(lifespan: Lifespan | None = None) -> FastAPI` in `compliance_service.infra.http.app`; `GET /health` → `200 {"status": "UP"}`.

- [ ] **Step 1: Pin Python and rewrite `pyproject.toml`**

```bash
uv python pin 3.13
rm src/__init__.py src/main.py   # untracked scaffold files
```

`pyproject.toml`:

```toml
[project]
name = "compliance-service"
version = "0.1.0"
description = "Simulated product compliance analysis for omni-market"
requires-python = ">=3.13"
dependencies = [
    "aiokafka>=0.14.0",
    "alembic>=1.20.0",
    "asyncpg>=0.32.0",
    "cloudevents>=2.2.0",
    "fastapi[standard]>=0.143.2",
    "opentelemetry-exporter-otlp-proto-http>=1.45.1",
    "opentelemetry-instrumentation-aiokafka>=0.66b1",
    "opentelemetry-instrumentation-fastapi>=0.66b1",
    "opentelemetry-instrumentation-logging>=0.66b1",
    "opentelemetry-instrumentation-sqlalchemy>=0.66b1",
    "opentelemetry-sdk>=1.45.1",
    "pydantic-settings>=2.16.0",
    "sqlalchemy[asyncio]>=2.1.4",
]

[dependency-groups]
dev = [
    "pytest>=9.1.1",
    "pytest-asyncio>=1.4.0",
    "ruff>=0.17.1",
    "testcontainers[postgres]>=4.15.0",
]

[build-system]
requires = ["uv_build>=0.13.1,<0.14.0"]
build-backend = "uv_build"

[tool.fastapi]
entrypoint = "compliance_service.main:app"

[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "--import-mode=importlib"
asyncio_mode = "auto"
asyncio_default_fixture_loop_scope = "function"

[tool.ruff]
line-length = 120
target-version = "py313"

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B"]
```

`.gitignore`:

```
.venv/
__pycache__/
.pytest_cache/
.ruff_cache/
.env
```

- [ ] **Step 2: Install**

Run: `uv sync`
Expected: it recreates `.venv` with Python 3.13 and ends with `Installed N packages`, including `compliance-service` (editable).

- [ ] **Step 3: Write the failing test**

`tests/infra/http/test_health.py`:

```python
from httpx import ASGITransport, AsyncClient

from compliance_service.infra.http.app import create_app


async def test_health_returns_up():
    async with AsyncClient(transport=ASGITransport(app=create_app()), base_url="http://test") as client:
        response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "UP"}
```

- [ ] **Step 4: Run it to verify it fails**

Run: `uv run pytest tests/infra/http/test_health.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'compliance_service.infra'`.

- [ ] **Step 5: Implement**

Create the empty `__init__.py` files (`src/compliance_service/`, `infra/`, `infra/http/`).

`src/compliance_service/infra/http/health.py`:

```python
from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "UP"}
```

`src/compliance_service/infra/http/app.py`:

```python
from fastapi import FastAPI
from starlette.types import Lifespan

from compliance_service.infra.http import health


def create_app(lifespan: Lifespan[FastAPI] | None = None) -> FastAPI:
    app = FastAPI(title="compliance-service", lifespan=lifespan)
    app.include_router(health.router)
    return app
```

`src/compliance_service/main.py` (temporary; Task 10 replaces it):

```python
from compliance_service.infra.http.app import create_app

app = create_app()
```

- [ ] **Step 6: Run the tests and lint**

Run: `uv run pytest -v && uv run ruff check && uv run ruff format --check`
Expected: 1 passed; ruff reports `All checks passed!` and no files to reformat.

- [ ] **Step 7: Commit**

```bash
git add pyproject.toml uv.lock .python-version .gitignore src tests
git commit -m "chore(compliance): configura projeto python 3.13 com fastapi e health check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Domain model (errors, Product, Violation, ComplianceReport, ProductAnalysis)

**Files:**
- Create: `src/compliance_service/core/__init__.py`, `core/shared/__init__.py`, `core/shared/domain/__init__.py`, `core/shared/domain/errors.py`
- Create: `core/product/__init__.py`, `core/product/model/__init__.py`, `model/product_errors.py`, `model/product.py`, `model/violation.py`, `model/compliance_report.py`, `model/product_analysis.py`
- Test: `tests/conftest.py`, `tests/core/product/model/test_product.py`, `tests/core/product/model/test_product_analysis.py`

**Interfaces:**
- Produces:
  - `DomainError(Exception)`, `ValidationError(DomainError)`, `NotFoundError(DomainError)`, `ConflictError(DomainError)` in `compliance_service.core.shared.domain.errors`
  - `InvalidProductError(ValidationError)` in `...core.product.model.product_errors`
  - `Product(product_id: str, sku: str, name: str, description: str, price: Decimal, stock: int)`, a frozen dataclass, in `...model.product`
  - `Violation(rule_code: str, message: str)`, frozen, in `...model.violation`
  - `ComplianceReport()` with `.add(violation)`, `.violations -> tuple[Violation, ...]`, `.has_violations -> bool` in `...model.compliance_report`
  - `AnalysisStatus(StrEnum)` with `APPROVED`, `REJECTED`, and `ProductAnalysis(id: UUID, product_id, sku, status, violations: tuple[Violation, ...], analyzed_at: datetime)` with classmethod `of(product, report, now) -> ProductAnalysis`, in `...model.product_analysis`
  - pytest fixture `make_product(**overrides) -> Product` in `tests/conftest.py` (defaults: `product_id="p-1"`, `sku="SKU-1"`, `name="Cadeira de escritório"`, `description="Cadeira ergonômica com apoio lombar"`, `price=Decimal("899.90")`, `stock=10`)

- [ ] **Step 1: Write the failing tests**

`tests/conftest.py`:

```python
from decimal import Decimal

import pytest

from compliance_service.core.product.model.product import Product


@pytest.fixture
def make_product():
    def _make(**overrides) -> Product:
        fields = {
            "product_id": "p-1",
            "sku": "SKU-1",
            "name": "Cadeira de escritório",
            "description": "Cadeira ergonômica com apoio lombar",
            "price": Decimal("899.90"),
            "stock": 10,
        }
        fields.update(overrides)
        return Product(**fields)

    return _make
```

`tests/core/product/model/test_product.py`:

```python
from decimal import Decimal

import pytest

from compliance_service.core.product.model.product_errors import InvalidProductError
from compliance_service.core.shared.domain.errors import ValidationError


def test_creates_a_valid_product(make_product):
    product = make_product()

    assert product.sku == "SKU-1"
    assert product.price == Decimal("899.90")


@pytest.mark.parametrize("field", ["product_id", "sku", "name"])
def test_rejects_blank_identifying_fields(make_product, field):
    with pytest.raises(InvalidProductError, match=field):
        make_product(**{field: "   "})


def test_rejects_negative_price(make_product):
    with pytest.raises(InvalidProductError, match="price"):
        make_product(price=Decimal("-0.01"))


def test_rejects_negative_stock(make_product):
    with pytest.raises(InvalidProductError, match="stock"):
        make_product(stock=-1)


def test_accepts_an_empty_description(make_product):
    assert make_product(description="").description == ""


def test_invalid_product_is_a_validation_error():
    assert issubclass(InvalidProductError, ValidationError)
```

`tests/core/product/model/test_product_analysis.py`:

```python
from datetime import UTC, datetime

from compliance_service.core.product.model.compliance_report import ComplianceReport
from compliance_service.core.product.model.product_analysis import AnalysisStatus, ProductAnalysis
from compliance_service.core.product.model.violation import Violation

NOW = datetime(2026, 10, 15, 12, 0, tzinfo=UTC)


def test_is_approved_when_the_report_has_no_violations(make_product):
    analysis = ProductAnalysis.of(make_product(), ComplianceReport(), NOW)

    assert analysis.status is AnalysisStatus.APPROVED
    assert analysis.violations == ()
    assert analysis.product_id == "p-1"
    assert analysis.sku == "SKU-1"
    assert analysis.analyzed_at == NOW


def test_is_rejected_when_the_report_has_violations(make_product):
    report = ComplianceReport()
    violation = Violation("PRICE_CEILING", "Too expensive.")
    report.add(violation)

    analysis = ProductAnalysis.of(make_product(), report, NOW)

    assert analysis.status is AnalysisStatus.REJECTED
    assert analysis.violations == (violation,)


def test_each_analysis_has_its_own_id(make_product):
    first = ProductAnalysis.of(make_product(), ComplianceReport(), NOW)
    second = ProductAnalysis.of(make_product(), ComplianceReport(), NOW)

    assert first.id != second.id


def test_report_exposes_violations_in_insertion_order():
    report = ComplianceReport()
    first, second = Violation("A", "a"), Violation("B", "b")
    report.add(first)
    report.add(second)

    assert report.has_violations
    assert report.violations == (first, second)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `uv run pytest tests/core -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'compliance_service.core'`.

- [ ] **Step 3: Implement**

Create the empty `__init__.py` files listed under Files.

`core/shared/domain/errors.py`:

```python
class DomainError(Exception):
    """Base class for every error raised by the core."""


class ValidationError(DomainError):
    """A value or invariant is invalid."""


class NotFoundError(DomainError):
    """The requested entity does not exist."""


class ConflictError(DomainError):
    """A valid operation clashes with the current state."""
```

`core/product/model/product_errors.py`:

```python
from compliance_service.core.shared.domain.errors import ValidationError


class InvalidProductError(ValidationError):
    pass
```

`core/product/model/product.py`:

```python
from dataclasses import dataclass
from decimal import Decimal

from compliance_service.core.product.model.product_errors import InvalidProductError


@dataclass(frozen=True)
class Product:
    product_id: str
    sku: str
    name: str
    description: str
    price: Decimal
    stock: int

    def __post_init__(self) -> None:
        for field_name in ("product_id", "sku", "name"):
            if not getattr(self, field_name).strip():
                raise InvalidProductError(f"{field_name} must not be blank.")
        if self.price < 0:
            raise InvalidProductError("price must not be negative.")
        if self.stock < 0:
            raise InvalidProductError("stock must not be negative.")
```

`core/product/model/violation.py`:

```python
from dataclasses import dataclass


@dataclass(frozen=True)
class Violation:
    rule_code: str
    message: str
```

`core/product/model/compliance_report.py`:

```python
from compliance_service.core.product.model.violation import Violation


class ComplianceReport:
    def __init__(self) -> None:
        self._violations: list[Violation] = []

    def add(self, violation: Violation) -> None:
        self._violations.append(violation)

    @property
    def violations(self) -> tuple[Violation, ...]:
        return tuple(self._violations)

    @property
    def has_violations(self) -> bool:
        return bool(self._violations)
```

`core/product/model/product_analysis.py`:

```python
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from uuid import UUID, uuid4

from compliance_service.core.product.model.compliance_report import ComplianceReport
from compliance_service.core.product.model.product import Product
from compliance_service.core.product.model.violation import Violation


class AnalysisStatus(StrEnum):
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


@dataclass(frozen=True)
class ProductAnalysis:
    id: UUID
    product_id: str
    sku: str
    status: AnalysisStatus
    violations: tuple[Violation, ...]
    analyzed_at: datetime

    @classmethod
    def of(cls, product: Product, report: ComplianceReport, now: datetime) -> "ProductAnalysis":
        status = AnalysisStatus.REJECTED if report.has_violations else AnalysisStatus.APPROVED
        return cls(
            id=uuid4(),
            product_id=product.product_id,
            sku=product.sku,
            status=status,
            violations=report.violations,
            analyzed_at=now,
        )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/core -v && uv run ruff check`
Expected: 12 passed; `All checks passed!`.

- [ ] **Step 5: Commit**

```bash
git add src/compliance_service/core tests/conftest.py tests/core
git commit -m "feat(compliance): adiciona modelo de domínio de produto e análise

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Rule chain (chain of responsibility) and the three rules

**Files:**
- Create: `core/product/model/rules/__init__.py`, `rules/compliance_handler.py`, `rules/prohibited_terms_rule.py`, `rules/price_ceiling_rule.py`, `rules/description_required_rule.py`
- Test: `tests/core/product/model/rules/test_compliance_handler.py`, `tests/core/product/model/rules/test_rules.py`

**Interfaces:**
- Consumes: `Product`, `Violation`, `ComplianceReport` (Task 2).
- Produces (all under `compliance_service.core.product.model.rules`):
  - `ComplianceHandler(ABC)` with class attributes `code: str` and `blocking: bool = False`, plus `set_next(handler) -> ComplianceHandler` (returns its argument), `handle(product, report) -> ComplianceReport` and abstract `_check(product) -> Violation | None`. Subclasses call `super().__init__()`.
  - `build_chain(first: ComplianceHandler, *rest: ComplianceHandler) -> ComplianceHandler` (returns `first`).
  - `ProhibitedTermsRule(terms: Iterable[str] = DEFAULT_PROHIBITED_TERMS)`, code `PROHIBITED_TERMS`, blocking.
  - `PriceCeilingRule(ceiling: Decimal = Decimal("100000"))`, code `PRICE_CEILING`.
  - `DescriptionRequiredRule(min_length: int = 20)`, code `DESCRIPTION_REQUIRED`.

- [ ] **Step 1: Write the failing tests**

`tests/core/product/model/rules/test_compliance_handler.py`:

```python
import pytest

from compliance_service.core.product.model.compliance_report import ComplianceReport
from compliance_service.core.product.model.rules.compliance_handler import ComplianceHandler, build_chain
from compliance_service.core.product.model.violation import Violation


class StubRule(ComplianceHandler):
    def __init__(self, code: str, calls: list[str], *, violates: bool, blocking: bool = False) -> None:
        super().__init__()
        self.code = code
        self.blocking = blocking
        self._calls = calls
        self._violates = violates

    def _check(self, product):
        self._calls.append(self.code)
        return Violation(self.code, f"{self.code} violated") if self._violates else None


def test_runs_every_handler_in_order(make_product):
    calls: list[str] = []
    chain = build_chain(StubRule("A", calls, violates=False), StubRule("B", calls, violates=False))

    report = chain.handle(make_product(), ComplianceReport())

    assert calls == ["A", "B"]
    assert not report.has_violations


def test_non_blocking_handlers_accumulate_violations(make_product):
    calls: list[str] = []
    chain = build_chain(StubRule("A", calls, violates=True), StubRule("B", calls, violates=True))

    report = chain.handle(make_product(), ComplianceReport())

    assert [v.rule_code for v in report.violations] == ["A", "B"]


def test_a_blocking_violation_stops_the_chain(make_product):
    calls: list[str] = []
    chain = build_chain(
        StubRule("A", calls, violates=True, blocking=True),
        StubRule("B", calls, violates=True),
    )

    report = chain.handle(make_product(), ComplianceReport())

    assert calls == ["A"]
    assert [v.rule_code for v in report.violations] == ["A"]


def test_a_blocking_handler_without_violation_passes_on(make_product):
    calls: list[str] = []
    chain = build_chain(StubRule("A", calls, violates=False, blocking=True), StubRule("B", calls, violates=True))

    report = chain.handle(make_product(), ComplianceReport())

    assert calls == ["A", "B"]
    assert [v.rule_code for v in report.violations] == ["B"]


def test_build_chain_returns_the_first_handler():
    first = StubRule("A", [], violates=False)

    assert build_chain(first, StubRule("B", [], violates=False)) is first


def test_build_chain_requires_a_handler():
    with pytest.raises(TypeError):
        build_chain()
```

`tests/core/product/model/rules/test_rules.py`:

```python
from decimal import Decimal

from compliance_service.core.product.model.rules.description_required_rule import DescriptionRequiredRule
from compliance_service.core.product.model.rules.price_ceiling_rule import PriceCeilingRule
from compliance_service.core.product.model.rules.prohibited_terms_rule import ProhibitedTermsRule


def check(rule, product):
    return rule._check(product)


class TestProhibitedTermsRule:
    def test_flags_a_term_in_the_name(self, make_product):
        violation = check(ProhibitedTermsRule(), make_product(name="Pistola de airsoft"))

        assert violation.rule_code == "PROHIBITED_TERMS"
        assert "pistola" in violation.message

    def test_flags_a_term_in_the_description(self, make_product):
        violation = check(ProhibitedTermsRule(), make_product(description="Tênis réplica idêntico ao original"))

        assert "replica" in violation.message

    def test_ignores_case_and_accents(self, make_product):
        assert check(ProhibitedTermsRule(), make_product(name="Caixa de MUNIÇÃO")) is not None

    def test_matches_whole_words_only(self, make_product):
        assert check(ProhibitedTermsRule(), make_product(name="Biscoito crackers integral")) is None

    def test_matches_multi_word_terms(self, make_product):
        assert check(ProhibitedTermsRule(), make_product(description="Réplica de arma de fogo antiga")) is not None

    def test_lists_every_term_found_once_and_sorted(self, make_product):
        product = make_product(name="Pistola pistola", description="com munição")

        violation = check(ProhibitedTermsRule(), product)

        assert violation.message == "Name or description contains prohibited terms: municao, pistola."

    def test_accepts_custom_terms(self, make_product):
        rule = ProhibitedTermsRule(terms=["cadeira"])

        assert check(rule, make_product()) is not None

    def test_never_flags_with_an_empty_term_list(self, make_product):
        assert check(ProhibitedTermsRule(terms=[]), make_product(name="Pistola")) is None

    def test_approves_a_regular_product(self, make_product):
        assert check(ProhibitedTermsRule(), make_product()) is None

    def test_is_blocking(self):
        assert ProhibitedTermsRule.blocking is True


class TestPriceCeilingRule:
    def test_accepts_a_price_at_the_ceiling(self, make_product):
        assert check(PriceCeilingRule(Decimal("1000")), make_product(price=Decimal("1000"))) is None

    def test_flags_a_price_above_the_ceiling(self, make_product):
        violation = check(PriceCeilingRule(Decimal("1000")), make_product(price=Decimal("1000.01")))

        assert violation.rule_code == "PRICE_CEILING"
        assert violation.message == "Price 1000.01 exceeds the ceiling of 1000."

    def test_defaults_to_one_hundred_thousand(self, make_product):
        assert check(PriceCeilingRule(), make_product(price=Decimal("100000.01"))) is not None

    def test_is_not_blocking(self):
        assert PriceCeilingRule.blocking is False


class TestDescriptionRequiredRule:
    def test_accepts_a_description_at_the_minimum_length(self, make_product):
        assert check(DescriptionRequiredRule(5), make_product(description="abcde")) is None

    def test_flags_a_short_description(self, make_product):
        violation = check(DescriptionRequiredRule(5), make_product(description="abcd"))

        assert violation.rule_code == "DESCRIPTION_REQUIRED"
        assert violation.message == "Description must have at least 5 characters."

    def test_ignores_surrounding_whitespace(self, make_product):
        assert check(DescriptionRequiredRule(5), make_product(description="   ab   ")) is not None

    def test_flags_an_empty_description_by_default(self, make_product):
        assert check(DescriptionRequiredRule(), make_product(description="")) is not None

    def test_is_not_blocking(self):
        assert DescriptionRequiredRule.blocking is False
```

- [ ] **Step 2: Run them to verify they fail**

Run: `uv run pytest tests/core/product/model/rules -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'compliance_service.core.product.model.rules'`.

- [ ] **Step 3: Implement**

`rules/__init__.py`: empty.

`rules/compliance_handler.py`:

```python
from abc import ABC, abstractmethod

from compliance_service.core.product.model.compliance_report import ComplianceReport
from compliance_service.core.product.model.product import Product
from compliance_service.core.product.model.violation import Violation


class ComplianceHandler(ABC):
    """A link in the compliance chain. A blocking link that finds a violation ends the analysis."""

    code: str
    blocking: bool = False

    def __init__(self) -> None:
        self._next: ComplianceHandler | None = None

    def set_next(self, handler: "ComplianceHandler") -> "ComplianceHandler":
        self._next = handler
        return handler

    def handle(self, product: Product, report: ComplianceReport) -> ComplianceReport:
        violation = self._check(product)
        if violation:
            report.add(violation)
            if self.blocking:
                return report
        return self._next.handle(product, report) if self._next else report

    @abstractmethod
    def _check(self, product: Product) -> Violation | None: ...


def build_chain(first: ComplianceHandler, *rest: ComplianceHandler) -> ComplianceHandler:
    current = first
    for handler in rest:
        current = current.set_next(handler)
    return first
```

`rules/prohibited_terms_rule.py`:

```python
import re
import unicodedata
from collections.abc import Iterable

from compliance_service.core.product.model.product import Product
from compliance_service.core.product.model.rules.compliance_handler import ComplianceHandler
from compliance_service.core.product.model.violation import Violation

DEFAULT_PROHIBITED_TERMS: tuple[str, ...] = (
    # weapons
    "arma de fogo", "pistola", "revólver", "fuzil", "munição", "firearm", "pistol", "ammunition",
    # drugs
    "cocaína", "maconha", "heroína", "crack", "lsd", "cocaine", "marijuana", "heroin",
    # counterfeit goods
    "falsificado", "falsificada", "réplica", "pirata", "counterfeit",
    # controlled medicines
    "anabolizante", "esteroide", "rivotril", "oxicodona", "steroid", "oxycodone",
)  # fmt: skip


def _normalize(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text.casefold())
    return "".join(char for char in decomposed if not unicodedata.combining(char))


class ProhibitedTermsRule(ComplianceHandler):
    code = "PROHIBITED_TERMS"
    blocking = True

    def __init__(self, terms: Iterable[str] = DEFAULT_PROHIBITED_TERMS) -> None:
        super().__init__()
        normalized = sorted({_normalize(term) for term in terms if term.strip()}, key=len, reverse=True)
        self._pattern = re.compile(r"\b(" + "|".join(map(re.escape, normalized)) + r")\b") if normalized else None

    def _check(self, product: Product) -> Violation | None:
        if self._pattern is None:
            return None
        found = sorted(set(self._pattern.findall(_normalize(f"{product.name}\n{product.description}"))))
        if not found:
            return None
        return Violation(self.code, f"Name or description contains prohibited terms: {', '.join(found)}.")
```

`rules/price_ceiling_rule.py`:

```python
from decimal import Decimal

from compliance_service.core.product.model.product import Product
from compliance_service.core.product.model.rules.compliance_handler import ComplianceHandler
from compliance_service.core.product.model.violation import Violation


class PriceCeilingRule(ComplianceHandler):
    code = "PRICE_CEILING"

    def __init__(self, ceiling: Decimal = Decimal("100000")) -> None:
        super().__init__()
        self._ceiling = ceiling

    def _check(self, product: Product) -> Violation | None:
        if product.price <= self._ceiling:
            return None
        return Violation(self.code, f"Price {product.price} exceeds the ceiling of {self._ceiling}.")
```

`rules/description_required_rule.py`:

```python
from compliance_service.core.product.model.product import Product
from compliance_service.core.product.model.rules.compliance_handler import ComplianceHandler
from compliance_service.core.product.model.violation import Violation


class DescriptionRequiredRule(ComplianceHandler):
    code = "DESCRIPTION_REQUIRED"

    def __init__(self, min_length: int = 20) -> None:
        super().__init__()
        self._min_length = min_length

    def _check(self, product: Product) -> Violation | None:
        if len(product.description.strip()) >= self._min_length:
            return None
        return Violation(self.code, f"Description must have at least {self._min_length} characters.")
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/core -v && uv run ruff check && uv run ruff format --check`
Expected: all pass (12 from Task 2 + 6 + 19); ruff clean.

- [ ] **Step 5: Commit**

```bash
git add src/compliance_service/core/product/model/rules tests/core/product/model/rules
git commit -m "feat(compliance): adiciona cadeia de regras de compliance

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Ports and ProductFacade

**Files:**
- Create: `core/product/port/__init__.py`, `port/in_/__init__.py`, `port/in_/analyze_product_port.py`, `port/out/__init__.py`, `port/out/product_analysis_repository.py`, `port/out/analysis_result_publisher.py`, `port/out/clock.py`, `core/product/product_facade.py`
- Test: `tests/core/product/test_product_facade.py`

**Interfaces:**
- Consumes: Task 2 model; `ComplianceHandler`, `build_chain`, `PriceCeilingRule` (Task 3).
- Produces:
  - `AnalyzeProductPort(Protocol)`: `async analyze(product: Product) -> ProductAnalysis`
  - `ProductAnalysisRepository(Protocol)`: `async save(analysis: ProductAnalysis) -> None`
  - `AnalysisResultPublisher(Protocol)`: `async publish(analysis: ProductAnalysis) -> None`
  - `Clock(Protocol)`: `now() -> datetime`
  - `ProductFacade(rules: ComplianceHandler, repository: ProductAnalysisRepository, publisher: AnalysisResultPublisher, clock: Clock)` implementing `AnalyzeProductPort`

- [ ] **Step 1: Write the failing test**

`tests/core/product/test_product_facade.py`:

```python
from datetime import UTC, datetime
from decimal import Decimal

import pytest

from compliance_service.core.product.model.product_analysis import AnalysisStatus
from compliance_service.core.product.model.rules.compliance_handler import build_chain
from compliance_service.core.product.model.rules.price_ceiling_rule import PriceCeilingRule
from compliance_service.core.product.product_facade import ProductFacade

NOW = datetime(2026, 10, 15, 12, 0, tzinfo=UTC)


class FixedClock:
    def now(self):
        return NOW


class RecordingPublisher:
    def __init__(self, log):
        self.log = log
        self.published = []

    async def publish(self, analysis):
        self.log.append("publish")
        self.published.append(analysis)


class FailingPublisher:
    async def publish(self, analysis):
        raise RuntimeError("broker down")


class RecordingRepository:
    def __init__(self, log):
        self.log = log
        self.saved = []

    async def save(self, analysis):
        self.log.append("save")
        self.saved.append(analysis)


def make_facade(log, publisher=None):
    repository = RecordingRepository(log)
    publisher = publisher or RecordingPublisher(log)
    facade = ProductFacade(build_chain(PriceCeilingRule(Decimal("1000"))), repository, publisher, FixedClock())
    return facade, repository, publisher


async def test_approves_a_compliant_product(make_product):
    facade, repository, publisher = make_facade([])

    analysis = await facade.analyze(make_product(price=Decimal("10")))

    assert analysis.status is AnalysisStatus.APPROVED
    assert analysis.analyzed_at == NOW
    assert publisher.published == [analysis]
    assert repository.saved == [analysis]


async def test_rejects_a_product_that_breaks_a_rule(make_product):
    facade, _, _ = make_facade([])

    analysis = await facade.analyze(make_product(price=Decimal("5000")))

    assert analysis.status is AnalysisStatus.REJECTED
    assert [v.rule_code for v in analysis.violations] == ["PRICE_CEILING"]


async def test_publishes_before_saving(make_product):
    log: list[str] = []
    facade, _, _ = make_facade(log)

    await facade.analyze(make_product())

    assert log == ["publish", "save"]


async def test_does_not_save_when_publishing_fails(make_product):
    facade, repository, _ = make_facade([], publisher=FailingPublisher())

    with pytest.raises(RuntimeError):
        await facade.analyze(make_product())

    assert repository.saved == []
```

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run pytest tests/core/product/test_product_facade.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'compliance_service.core.product.product_facade'`.

- [ ] **Step 3: Implement**

Create the empty `__init__.py` files in `port/`, `port/in_/` and `port/out/`.

`port/in_/analyze_product_port.py`:

```python
from typing import Protocol

from compliance_service.core.product.model.product import Product
from compliance_service.core.product.model.product_analysis import ProductAnalysis


class AnalyzeProductPort(Protocol):
    async def analyze(self, product: Product) -> ProductAnalysis: ...
```

`port/out/product_analysis_repository.py`:

```python
from typing import Protocol

from compliance_service.core.product.model.product_analysis import ProductAnalysis


class ProductAnalysisRepository(Protocol):
    async def save(self, analysis: ProductAnalysis) -> None: ...
```

`port/out/analysis_result_publisher.py`:

```python
from typing import Protocol

from compliance_service.core.product.model.product_analysis import ProductAnalysis


class AnalysisResultPublisher(Protocol):
    async def publish(self, analysis: ProductAnalysis) -> None: ...
```

`port/out/clock.py`:

```python
from datetime import datetime
from typing import Protocol


class Clock(Protocol):
    def now(self) -> datetime: ...
```

`core/product/product_facade.py`:

```python
from compliance_service.core.product.model.compliance_report import ComplianceReport
from compliance_service.core.product.model.product import Product
from compliance_service.core.product.model.product_analysis import ProductAnalysis
from compliance_service.core.product.model.rules.compliance_handler import ComplianceHandler
from compliance_service.core.product.port.out.analysis_result_publisher import AnalysisResultPublisher
from compliance_service.core.product.port.out.clock import Clock
from compliance_service.core.product.port.out.product_analysis_repository import ProductAnalysisRepository


class ProductFacade:
    def __init__(
        self,
        rules: ComplianceHandler,
        repository: ProductAnalysisRepository,
        publisher: AnalysisResultPublisher,
        clock: Clock,
    ) -> None:
        self._rules = rules
        self._repository = repository
        self._publisher = publisher
        self._clock = clock

    async def analyze(self, product: Product) -> ProductAnalysis:
        report = self._rules.handle(product, ComplianceReport())
        analysis = ProductAnalysis.of(product, report, self._clock.now())
        await self._publisher.publish(analysis)
        await self._repository.save(analysis)
        return analysis
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/core -v && uv run ruff check`
Expected: all pass; ruff clean.

- [ ] **Step 5: Commit**

```bash
git add src/compliance_service/core/product tests/core/product/test_product_facade.py
git commit -m "feat(compliance): adiciona portas e facade de análise de produto

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Settings, compliance-db, Alembic and the initial migration

**Files:**
- Modify: `../compose.yaml` (add the `compliance-db` service and the `compliance-db-data` volume)
- Create: `.env.example`, `alembic.ini`
- Create: `infra/config/__init__.py`, `infra/config/settings.py`
- Create: `infra/persistence/__init__.py`, `infra/persistence/database.py`, `infra/persistence/tables.py`
- Create: `infra/persistence/migrations/env.py`, `migrations/script.py.mako`, `migrations/versions/0001_create_product_analyses_and_processed_events.py`
- Modify: `tests/conftest.py` (add the DB fixtures)
- Test: `tests/infra/config/test_settings.py`, `tests/infra/persistence/test_migrations.py`

**Interfaces:**
- Produces:
  - `Settings` (pydantic-settings) in `compliance_service.infra.config.settings`, with the fields `port: int`, `log_level: str`, `otel_service_name: str`, `otel_collector_url: str`, `database_url: str`, `kafka_brokers: str`, `product_created_topic: str`, `produto_analisado_topic: str`, `product_created_dlq_topic: str`, `price_ceiling: Decimal`, `description_min_length: int`, and the property `kafka_bootstrap_servers -> list[str]`
  - `create_engine(url: str) -> AsyncEngine` and `create_session_factory(engine) -> async_sessionmaker[AsyncSession]` in `...infra.persistence.database`
  - `metadata`, `product_analyses`, `processed_events` (SQLAlchemy `Table`s) in `...infra.persistence.tables`
  - pytest fixtures `database_url` (session; starts Postgres and runs `alembic upgrade head`), `engine` (truncates both tables after each test) and `session_factory`

- [ ] **Step 1: Add `compliance-db` to `../compose.yaml`**

Insert after the `catalog-db` service:

```yaml
  compliance-db:
    image: postgres:18-alpine
    container_name: compliance-db
    environment:
      POSTGRES_DB: ${COMPLIANCE_DB_NAME:-compliance}
      POSTGRES_USER: ${COMPLIANCE_DB_USER:-compliance}
      POSTGRES_PASSWORD: ${COMPLIANCE_DB_PASSWORD:-compliance}
    ports:
      - "5433:5432"
    volumes:
      - compliance-db-data:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s
```

Add `compliance-db-data:` under `volumes:` after `catalog-db-data:`.

Run: `docker compose -f ../compose.yaml config --quiet && echo ok`
Expected: `ok`.

- [ ] **Step 2: Write the failing tests**

`tests/infra/config/test_settings.py`:

```python
from decimal import Decimal

from compliance_service.infra.config.settings import Settings


def test_has_local_defaults(monkeypatch):
    for name in ("DATABASE_URL", "KAFKA_BROKERS", "PRICE_CEILING", "PORT"):
        monkeypatch.delenv(name, raising=False)

    settings = Settings(_env_file=None)

    assert settings.port == 8083
    assert settings.database_url == "postgresql+asyncpg://compliance:compliance@localhost:5433/compliance"
    assert settings.product_created_topic == "catalog.product.created.v1"
    assert settings.produto_analisado_topic == "produto.analisado.v1"
    assert settings.product_created_dlq_topic == "compliance.product-created.dlq"
    assert settings.price_ceiling == Decimal("100000")
    assert settings.description_min_length == 20


def test_reads_environment_variables(monkeypatch):
    monkeypatch.setenv("PRICE_CEILING", "500.50")
    monkeypatch.setenv("KAFKA_BROKERS", "kafka:19092, other:9092")

    settings = Settings(_env_file=None)

    assert settings.price_ceiling == Decimal("500.50")
    assert settings.kafka_bootstrap_servers == ["kafka:19092", "other:9092"]
```

`tests/infra/persistence/test_migrations.py`:

```python
import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError


async def test_creates_the_tables(engine):
    async with engine.connect() as connection:
        names = await connection.run_sync(lambda sync: sa.inspect(sync).get_table_names())

    assert {"product_analyses", "processed_events"} <= set(names)


async def test_constrains_the_analysis_status(engine):
    with pytest.raises(IntegrityError):
        async with engine.begin() as connection:
            await connection.execute(
                sa.text(
                    "INSERT INTO product_analyses (id, product_id, sku, status, analyzed_at) "
                    "VALUES (gen_random_uuid(), 'p-1', 'SKU-1', 'MAYBE', now())"
                )
            )
```

Append to `tests/conftest.py` (keeping the existing `make_product` fixture and merging the imports at the top):

```python
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from testcontainers.community.postgres import PostgresContainer

from compliance_service.infra.persistence.database import create_engine, create_session_factory

SERVICE_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session")
def database_url() -> Iterator[str]:
    with PostgresContainer("postgres:18-alpine", driver="asyncpg") as postgres:
        url = postgres.get_connection_url()
        config = Config(str(SERVICE_ROOT / "alembic.ini"))
        config.set_main_option("sqlalchemy.url", url)
        command.upgrade(config, "head")
        yield url


@pytest.fixture
async def engine(database_url) -> AsyncIterator:
    engine = create_engine(database_url)
    yield engine
    async with engine.begin() as connection:
        await connection.execute(text("TRUNCATE product_analyses, processed_events"))
    await engine.dispose()


@pytest.fixture
def session_factory(engine):
    return create_session_factory(engine)
```

- [ ] **Step 3: Run them to verify they fail**

Run: `uv run pytest tests/infra/config tests/infra/persistence -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'compliance_service.infra.config'` (or `...infra.persistence`, raised while loading `conftest.py`).

- [ ] **Step 4: Implement settings and the database module**

Create the empty `infra/config/__init__.py` and `infra/persistence/__init__.py`.

`infra/config/settings.py`:

```python
from decimal import Decimal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    port: int = 8083
    log_level: str = "INFO"
    otel_service_name: str = "compliance-service"
    otel_collector_url: str = "http://localhost:4318"
    database_url: str = "postgresql+asyncpg://compliance:compliance@localhost:5433/compliance"
    kafka_brokers: str = "localhost:9092"
    product_created_topic: str = "catalog.product.created.v1"
    produto_analisado_topic: str = "produto.analisado.v1"
    product_created_dlq_topic: str = "compliance.product-created.dlq"
    price_ceiling: Decimal = Decimal("100000")
    description_min_length: int = 20

    @property
    def kafka_bootstrap_servers(self) -> list[str]:
        return [broker.strip() for broker in self.kafka_brokers.split(",") if broker.strip()]
```

`infra/persistence/database.py`:

```python
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine


def create_engine(url: str) -> AsyncEngine:
    return create_async_engine(url, pool_pre_ping=True)


def create_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)
```

`infra/persistence/tables.py`:

```python
from sqlalchemy import Column, DateTime, MetaData, Table, Text, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB

metadata = MetaData()

product_analyses = Table(
    "product_analyses",
    metadata,
    Column("id", Uuid, primary_key=True),
    Column("product_id", Text, nullable=False),
    Column("sku", Text, nullable=False),
    Column("status", Text, nullable=False),
    Column("violations", JSONB, nullable=False),
    Column("analyzed_at", DateTime(timezone=True), nullable=False),
)

processed_events = Table(
    "processed_events",
    metadata,
    Column("event_id", Text, primary_key=True),
    Column("event_type", Text, nullable=False),
    Column("processed_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
)
```

- [ ] **Step 5: Add Alembic**

`alembic.ini`:

```ini
[alembic]
script_location = %(here)s/src/compliance_service/infra/persistence/migrations
prepend_sys_path = .
path_separator = os
```

`migrations/env.py` (logging is configured by the app, so this file does not call `fileConfig`):

```python
import asyncio

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from compliance_service.infra.config.settings import Settings
from compliance_service.infra.persistence.tables import metadata

config = context.config
target_metadata = metadata


def _database_url() -> str:
    return config.get_main_option("sqlalchemy.url") or Settings().database_url


def run_migrations_offline() -> None:
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def _run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    engine = create_async_engine(_database_url(), poolclass=pool.NullPool)
    async with engine.connect() as connection:
        await connection.run_sync(_run_migrations)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
```

`migrations/script.py.mako`:

```mako
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
${imports if imports else ""}

revision: str = ${repr(up_revision)}
down_revision: str | Sequence[str] | None = ${repr(down_revision)}
branch_labels: str | Sequence[str] | None = ${repr(branch_labels)}
depends_on: str | Sequence[str] | None = ${repr(depends_on)}


def upgrade() -> None:
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
```

`migrations/versions/0001_create_product_analyses_and_processed_events.py`:

```python
"""create product_analyses and processed_events

Revision ID: 0001
Revises:
Create Date: 2026-10-15

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "product_analyses",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("product_id", sa.Text(), nullable=False),
        sa.Column("sku", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("violations", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("analyzed_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("status IN ('APPROVED', 'REJECTED')", name="ck_product_analyses_status"),
    )
    op.create_index("ix_product_analyses_sku", "product_analyses", ["sku"])
    op.create_table(
        "processed_events",
        sa.Column("event_id", sa.Text(), primary_key=True),
        sa.Column("event_type", sa.Text(), nullable=False),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("processed_events")
    op.drop_index("ix_product_analyses_sku", table_name="product_analyses")
    op.drop_table("product_analyses")
```

`.env.example`:

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

- [ ] **Step 6: Run the tests to verify they pass**

Run: `uv run pytest tests/infra/config tests/infra/persistence -v`
Expected: 4 passed. The first run pulls `postgres:18-alpine`. If the sync `database_url` fixture fails with `asyncio.run() cannot be called from a running event loop`, run `command.upgrade` in a worker thread instead: `threading.Thread(target=command.upgrade, args=(config, "head"))`, started and then joined.

- [ ] **Step 7: Check the migration against the compose database**

Run: `docker compose -f ../compose.yaml up -d compliance-db && sleep 5 && uv run alembic upgrade head && uv run alembic current`
Expected: `0001 (head)`.

- [ ] **Step 8: Run the whole suite and lint, then commit**

Run: `uv run pytest && uv run ruff check && uv run ruff format --check`
Expected: all pass; ruff clean.

```bash
git add ../compose.yaml .env.example alembic.ini src/compliance_service/infra/config src/compliance_service/infra/persistence tests/conftest.py tests/infra/config tests/infra/persistence
git commit -m "feat(compliance): adiciona banco compliance-db, configurações e migração inicial

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Analysis repository and processed-events inbox

**Files:**
- Create: `infra/persistence/sqlalchemy_product_analysis_repository.py`, `infra/messaging/__init__.py`, `infra/messaging/inbox_store.py`
- Test: `tests/infra/persistence/test_sqlalchemy_product_analysis_repository.py`, `tests/infra/messaging/test_inbox_store.py`

**Interfaces:**
- Consumes: `ProductAnalysis`, `Violation`, `AnalysisStatus` (Task 2); `ProductAnalysisRepository` (Task 4); `product_analyses`, `processed_events`, `session_factory` fixture (Task 5).
- Produces:
  - `SqlAlchemyProductAnalysisRepository(session: AsyncSession)` implementing `ProductAnalysisRepository`. It stores violations as `[{"ruleCode": ..., "message": ...}]` and adds rows to the session without committing.
  - `InboxStore(Protocol)` with `async was_processed(event_id: str) -> bool` and `async mark_processed(event_id: str, event_type: str) -> None`, plus `SqlAlchemyInboxStore(session: AsyncSession)`, in `compliance_service.infra.messaging.inbox_store`. `mark_processed` raises `sqlalchemy.exc.IntegrityError` for an `event_id` that is already stored.

- [ ] **Step 1: Write the failing tests**

`tests/infra/persistence/test_sqlalchemy_product_analysis_repository.py`:

```python
from datetime import UTC, datetime

from sqlalchemy import select

from compliance_service.core.product.model.compliance_report import ComplianceReport
from compliance_service.core.product.model.product_analysis import ProductAnalysis
from compliance_service.core.product.model.violation import Violation
from compliance_service.infra.persistence.sqlalchemy_product_analysis_repository import (
    SqlAlchemyProductAnalysisRepository,
)
from compliance_service.infra.persistence.tables import product_analyses

NOW = datetime(2026, 10, 15, 12, 0, tzinfo=UTC)


def rejected_analysis(product):
    report = ComplianceReport()
    report.add(Violation("PRICE_CEILING", "Too expensive."))
    return ProductAnalysis.of(product, report, NOW)


async def test_saves_an_analysis(session_factory, make_product):
    analysis = rejected_analysis(make_product())

    async with session_factory() as session:
        await SqlAlchemyProductAnalysisRepository(session).save(analysis)
        await session.commit()

    async with session_factory() as session:
        row = (await session.execute(select(product_analyses))).one()

    assert row.id == analysis.id
    assert row.product_id == "p-1"
    assert row.sku == "SKU-1"
    assert row.status == "REJECTED"
    assert row.violations == [{"ruleCode": "PRICE_CEILING", "message": "Too expensive."}]
    assert row.analyzed_at == NOW


async def test_does_not_persist_without_commit(session_factory, make_product):
    async with session_factory() as session:
        await SqlAlchemyProductAnalysisRepository(session).save(rejected_analysis(make_product()))

    async with session_factory() as session:
        rows = (await session.execute(select(product_analyses))).all()

    assert rows == []
```

`tests/infra/messaging/test_inbox_store.py`:

```python
import pytest
from sqlalchemy.exc import IntegrityError

from compliance_service.infra.messaging.inbox_store import SqlAlchemyInboxStore


async def test_an_unknown_event_was_not_processed(session_factory):
    async with session_factory() as session:
        assert await SqlAlchemyInboxStore(session).was_processed("e-1") is False


async def test_remembers_a_processed_event(session_factory):
    async with session_factory() as session:
        await SqlAlchemyInboxStore(session).mark_processed("e-1", "catalog.product.created.v1")
        await session.commit()

    async with session_factory() as session:
        assert await SqlAlchemyInboxStore(session).was_processed("e-1") is True


async def test_rejects_marking_the_same_event_twice(session_factory):
    async with session_factory() as session:
        await SqlAlchemyInboxStore(session).mark_processed("e-1", "catalog.product.created.v1")
        await session.commit()

    async with session_factory() as session:
        with pytest.raises(IntegrityError):
            await SqlAlchemyInboxStore(session).mark_processed("e-1", "catalog.product.created.v1")


async def test_forgets_an_uncommitted_mark(session_factory):
    async with session_factory() as session:
        await SqlAlchemyInboxStore(session).mark_processed("e-1", "catalog.product.created.v1")

    async with session_factory() as session:
        assert await SqlAlchemyInboxStore(session).was_processed("e-1") is False
```

- [ ] **Step 2: Run them to verify they fail**

Run: `uv run pytest tests/infra/persistence/test_sqlalchemy_product_analysis_repository.py tests/infra/messaging/test_inbox_store.py -v`
Expected: FAIL with `ModuleNotFoundError` for `sqlalchemy_product_analysis_repository` and for `compliance_service.infra.messaging`.

- [ ] **Step 3: Implement**

`infra/persistence/sqlalchemy_product_analysis_repository.py`:

```python
from sqlalchemy import insert
from sqlalchemy.ext.asyncio import AsyncSession

from compliance_service.core.product.model.product_analysis import ProductAnalysis
from compliance_service.infra.persistence.tables import product_analyses


class SqlAlchemyProductAnalysisRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def save(self, analysis: ProductAnalysis) -> None:
        await self._session.execute(
            insert(product_analyses).values(
                id=analysis.id,
                product_id=analysis.product_id,
                sku=analysis.sku,
                status=analysis.status.value,
                violations=[{"ruleCode": v.rule_code, "message": v.message} for v in analysis.violations],
                analyzed_at=analysis.analyzed_at,
            )
        )
```

`infra/messaging/__init__.py`: empty.

`infra/messaging/inbox_store.py`:

```python
from typing import Protocol

from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from compliance_service.infra.persistence.tables import processed_events


class InboxStore(Protocol):
    async def was_processed(self, event_id: str) -> bool: ...

    async def mark_processed(self, event_id: str, event_type: str) -> None: ...


class SqlAlchemyInboxStore:
    """Remembers consumed events so a redelivered message is not analysed twice."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def was_processed(self, event_id: str) -> bool:
        result = await self._session.execute(
            select(processed_events.c.event_id).where(processed_events.c.event_id == event_id)
        )
        return result.first() is not None

    async def mark_processed(self, event_id: str, event_type: str) -> None:
        await self._session.execute(insert(processed_events).values(event_id=event_id, event_type=event_type))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest -v && uv run ruff check`
Expected: all pass; ruff clean.

- [ ] **Step 5: Commit**

```bash
git add src/compliance_service/infra tests/infra
git commit -m "feat(compliance): adiciona repositório de análises e tabela de eventos processados

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: CloudEvents codec, result publisher and dead letter publisher

**Files:**
- Create: `infra/messaging/kafka_record.py`, `infra/messaging/message_producer.py`, `infra/messaging/cloud_events.py`, `infra/messaging/kafka_analysis_result_publisher.py`, `infra/messaging/dead_letter.py`
- Test: `tests/infra/messaging/conftest.py`, `tests/infra/messaging/test_cloud_events.py`, `tests/infra/messaging/test_kafka_analysis_result_publisher.py`, `tests/infra/messaging/test_dead_letter.py`

**Interfaces:**
- Consumes: `Product`, `InvalidProductError`, `ProductAnalysis` (Task 2); `AnalysisResultPublisher` (Task 4).
- Produces:
  - `KafkaRecord(Protocol)` with attributes `topic: str`, `partition: int`, `offset: int`, `key: bytes | None`, `value: bytes | None`, `headers: Sequence[tuple[str, bytes | None]]` (aiokafka's `ConsumerRecord` matches it)
  - `MessageProducer(Protocol)`: `async send_and_wait(topic: str, value: bytes | None = None, key: bytes | None = None, headers: list[tuple[str, bytes]] | None = None) -> Any` (matches `AIOKafkaProducer`)
  - In `cloud_events.py`:
    - constants `PRODUCT_CREATED_TYPE = "catalog.product.created.v1"`, `PRODUTO_ANALISADO_TYPE = "produto.analisado.v1"`, `SOURCE = "compliance-service"`
    - `UnprocessableMessageError(Exception)`
    - `ProductCreatedEvent(event_id: str, event_type: str, product: Product)`
    - `read_product_created(headers, key, value) -> ProductCreatedEvent`, which raises `UnprocessableMessageError` or `InvalidProductError`
    - `OutgoingMessage(key: bytes, value: bytes, headers: list[tuple[str, bytes]])`
    - `write_produto_analisado(analysis) -> OutgoingMessage`
  - `KafkaAnalysisResultPublisher(producer: MessageProducer, topic: str)` implementing `AnalysisResultPublisher`
  - `DeadLetterPublisher(producer: MessageProducer, topic: str)` with `async send(record: KafkaRecord, reason: str) -> None`
  - test fixtures (in `tests/infra/messaging/conftest.py`):
    - `producer` → `RecordingProducer` with `.sent: list[SentMessage(topic, key, value, headers)]`
    - `make_record(**overrides)` → `FakeRecord`, which defaults to a valid catalog message with offset 7, partition 1 and a `traceparent` header
    - `catalog_headers` → the header list catalog sends

- [ ] **Step 1: Write the test fixtures**

`tests/infra/messaging/conftest.py`:

```python
import json
from dataclasses import dataclass, field

import pytest

TRACEPARENT = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"


@dataclass
class SentMessage:
    topic: str
    key: bytes | None
    value: bytes | None
    headers: list[tuple[str, bytes]]


class RecordingProducer:
    def __init__(self) -> None:
        self.sent: list[SentMessage] = []

    async def send_and_wait(self, topic, value=None, key=None, headers=None):
        self.sent.append(SentMessage(topic, key, value, list(headers or [])))


@dataclass
class FakeRecord:
    topic: str = "catalog.product.created.v1"
    partition: int = 1
    offset: int = 7
    key: bytes | None = b"p-1"
    value: bytes | None = None
    headers: list[tuple[str, bytes | None]] = field(default_factory=list)


def catalog_header_list(event_id: str = "e-1", event_type: str = "catalog.product.created.v1"):
    return [
        ("ce_specversion", b"1.0"),
        ("ce_id", event_id.encode()),
        ("ce_source", b"catalog-service"),
        ("ce_type", event_type.encode()),
        ("ce_subject", b"p-1"),
        ("ce_time", b"2026-10-15T10:00:00.000Z"),
        ("content-type", b"application/json"),
        ("traceparent", TRACEPARENT.encode()),
    ]


def catalog_value(**overrides) -> bytes:
    data = {
        "productId": "p-1",
        "sku": "SKU-1",
        "name": "Cadeira de escritório",
        "description": "Cadeira ergonômica com apoio lombar",
        "price": 899.9,
        "stock": 10,
    }
    data.update(overrides)
    return json.dumps(data).encode()


@pytest.fixture
def producer():
    return RecordingProducer()


@pytest.fixture
def catalog_headers():
    return catalog_header_list()


@pytest.fixture
def make_record():
    def _make(*, event_id: str = "e-1", event_type: str = "catalog.product.created.v1", **overrides) -> FakeRecord:
        fields = {"value": catalog_value(), "headers": catalog_header_list(event_id, event_type)}
        fields.update(overrides)
        return FakeRecord(**fields)

    return _make
```

- [ ] **Step 2: Write the failing tests**

`tests/infra/messaging/test_cloud_events.py`:

```python
import json
from datetime import UTC, datetime
from decimal import Decimal

import pytest

from compliance_service.core.product.model.compliance_report import ComplianceReport
from compliance_service.core.product.model.product_analysis import ProductAnalysis
from compliance_service.core.product.model.product_errors import InvalidProductError
from compliance_service.core.product.model.violation import Violation
from compliance_service.infra.messaging.cloud_events import (
    UnprocessableMessageError,
    read_product_created,
    write_produto_analisado,
)

NOW = datetime(2026, 10, 15, 12, 0, tzinfo=UTC)


def read(record):
    return read_product_created(record.headers, record.key, record.value)


class TestReadProductCreated:
    def test_reads_a_catalog_message(self, make_record):
        event = read(make_record())

        assert event.event_id == "e-1"
        assert event.event_type == "catalog.product.created.v1"
        assert event.product.product_id == "p-1"
        assert event.product.sku == "SKU-1"
        assert event.product.stock == 10

    def test_keeps_the_exact_decimal_price(self, make_record):
        record = make_record(value=json.dumps({**json.loads(make_record().value), "price": 19.99}).encode())

        assert read(record).product.price == Decimal("19.99")

    def test_accepts_an_empty_description(self, make_record):
        record = make_record(value=json.dumps({**json.loads(make_record().value), "description": ""}).encode())

        assert read(record).product.description == ""

    def test_ignores_headers_without_value(self, make_record, catalog_headers):
        record = make_record(headers=[*catalog_headers, ("x-empty", None)])

        assert read(record).event_id == "e-1"

    def test_rejects_another_event_type(self, make_record):
        with pytest.raises(UnprocessableMessageError, match="catalog.product.approved.v1"):
            read(make_record(event_type="catalog.product.approved.v1"))

    def test_rejects_a_message_without_cloud_event_headers(self, make_record):
        with pytest.raises(UnprocessableMessageError):
            read(make_record(headers=[("content-type", b"application/json")]))

    def test_rejects_invalid_json(self, make_record):
        with pytest.raises(UnprocessableMessageError):
            read(make_record(value=b"not json"))

    def test_rejects_an_empty_value(self, make_record):
        with pytest.raises(UnprocessableMessageError):
            read(make_record(value=None))

    def test_rejects_missing_fields(self, make_record):
        with pytest.raises(UnprocessableMessageError, match="sku"):
            read(make_record(value=json.dumps({"productId": "p-1"}).encode()))

    def test_lets_domain_validation_errors_through(self, make_record):
        record = make_record(value=json.dumps({**json.loads(make_record().value), "price": -1}).encode())

        with pytest.raises(InvalidProductError):
            read(record)


class TestWriteProdutoAnalisado:
    def analysis(self, make_product):
        report = ComplianceReport()
        report.add(Violation("PRICE_CEILING", "Too expensive."))
        return ProductAnalysis.of(make_product(), report, NOW)

    def test_uses_binary_mode_headers(self, make_product):
        headers = dict(write_produto_analisado(self.analysis(make_product)).headers)

        assert headers["ce_specversion"] == b"1.0"
        assert headers["ce_type"] == b"produto.analisado.v1"
        assert headers["ce_source"] == b"compliance-service"
        assert headers["ce_subject"] == b"p-1"
        assert headers["ce_time"] == b"2026-10-15T12:00:00Z"
        assert headers["content-type"] == b"application/json"

    def test_keys_by_product_id(self, make_product):
        assert write_produto_analisado(self.analysis(make_product)).key == b"p-1"

    def test_carries_the_result_catalog_expects(self, make_product):
        value = json.loads(write_produto_analisado(self.analysis(make_product)).value)

        assert value == {
            "sku": "SKU-1",
            "status": "REJECTED",
            "violations": [{"ruleCode": "PRICE_CEILING", "message": "Too expensive."}],
        }

    def test_gives_each_message_its_own_id(self, make_product):
        analysis = self.analysis(make_product)

        first = dict(write_produto_analisado(analysis).headers)["ce_id"]
        second = dict(write_produto_analisado(analysis).headers)["ce_id"]

        assert first != second
```

`tests/infra/messaging/test_kafka_analysis_result_publisher.py`:

```python
import json
from datetime import UTC, datetime

from compliance_service.core.product.model.compliance_report import ComplianceReport
from compliance_service.core.product.model.product_analysis import ProductAnalysis
from compliance_service.infra.messaging.kafka_analysis_result_publisher import KafkaAnalysisResultPublisher


async def test_sends_the_analysis_to_the_topic(producer, make_product):
    analysis = ProductAnalysis.of(make_product(), ComplianceReport(), datetime(2026, 10, 15, tzinfo=UTC))

    await KafkaAnalysisResultPublisher(producer, "produto.analisado.v1").publish(analysis)

    [message] = producer.sent
    assert message.topic == "produto.analisado.v1"
    assert message.key == b"p-1"
    assert json.loads(message.value)["status"] == "APPROVED"
    assert ("ce_type", b"produto.analisado.v1") in message.headers
```

`tests/infra/messaging/test_dead_letter.py`:

```python
from compliance_service.infra.messaging.dead_letter import DeadLetterPublisher


async def test_keeps_the_original_message_and_adds_dlq_headers(producer, make_record, catalog_headers):
    record = make_record(headers=[*catalog_headers, ("x-empty", None)])

    await DeadLetterPublisher(producer, "compliance.product-created.dlq").send(record, "Invalid CloudEvent.")

    [message] = producer.sent
    assert message.topic == "compliance.product-created.dlq"
    assert message.key == record.key
    assert message.value == record.value
    assert message.headers[: len(catalog_headers)] == catalog_headers
    assert ("x-empty", None) not in message.headers
    assert message.headers[len(catalog_headers) :] == [
        ("dlq-original-topic", b"catalog.product.created.v1"),
        ("dlq-original-partition", b"1"),
        ("dlq-original-offset", b"7"),
        ("dlq-reason", b"Invalid CloudEvent."),
    ]
```

- [ ] **Step 3: Run them to verify they fail**

Run: `uv run pytest tests/infra/messaging -v`
Expected: FAIL with `ModuleNotFoundError` for `cloud_events`, `kafka_analysis_result_publisher` and `dead_letter` (the inbox tests still pass).

- [ ] **Step 4: Implement**

`infra/messaging/kafka_record.py`:

```python
from collections.abc import Sequence
from typing import Protocol


class KafkaRecord(Protocol):
    topic: str
    partition: int
    offset: int
    key: bytes | None
    value: bytes | None
    headers: Sequence[tuple[str, bytes | None]]
```

`infra/messaging/message_producer.py`:

```python
from typing import Any, Protocol


class MessageProducer(Protocol):
    async def send_and_wait(
        self,
        topic: str,
        value: bytes | None = None,
        key: bytes | None = None,
        headers: list[tuple[str, bytes]] | None = None,
    ) -> Any: ...
```

`infra/messaging/cloud_events.py`:

```python
from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal
from uuid import uuid4

import pydantic
from cloudevents.core.bindings.kafka import KafkaMessage, from_binary, to_binary
from cloudevents.core.exceptions import BaseCloudEventException
from cloudevents.core.formats.json import JSONFormat
from cloudevents.core.v1.event import CloudEvent

from compliance_service.core.product.model.product import Product
from compliance_service.core.product.model.product_analysis import ProductAnalysis

PRODUCT_CREATED_TYPE = "catalog.product.created.v1"
PRODUTO_ANALISADO_TYPE = "produto.analisado.v1"
SOURCE = "compliance-service"

_FORMAT = JSONFormat()


class UnprocessableMessageError(Exception):
    """The message can never be processed, so retrying it is pointless."""


class _ProductCreatedData(pydantic.BaseModel):
    """Contract published by catalog-service. Translating it here keeps that vocabulary out of the core."""

    product_id: str = pydantic.Field(alias="productId")
    sku: str
    name: str
    description: str
    price: Decimal
    stock: int


@dataclass(frozen=True)
class ProductCreatedEvent:
    event_id: str
    event_type: str
    product: Product


@dataclass(frozen=True)
class OutgoingMessage:
    key: bytes
    value: bytes
    headers: list[tuple[str, bytes]]


def read_product_created(
    headers: Sequence[tuple[str, bytes | None]], key: bytes | None, value: bytes | None
) -> ProductCreatedEvent:
    message = KafkaMessage(
        headers={name: header for name, header in headers if header is not None},
        key=key,
        value=value or b"",
    )
    try:
        event = from_binary(message, _FORMAT)
    except (BaseCloudEventException, ValueError) as err:
        raise UnprocessableMessageError(f"Invalid CloudEvent: {err}") from err

    if event.get_type() != PRODUCT_CREATED_TYPE:
        raise UnprocessableMessageError(f"Unexpected event type {event.get_type()}.")

    try:
        data = _ProductCreatedData.model_validate(event.get_data())
    except pydantic.ValidationError as err:
        raise UnprocessableMessageError(f"Invalid product data: {err}") from err

    product = Product(
        product_id=data.product_id,
        sku=data.sku,
        name=data.name,
        description=data.description,
        price=data.price,
        stock=data.stock,
    )
    return ProductCreatedEvent(event_id=event.get_id(), event_type=event.get_type(), product=product)


def write_produto_analisado(analysis: ProductAnalysis) -> OutgoingMessage:
    event = CloudEvent(
        attributes={
            "specversion": "1.0",
            "id": str(uuid4()),
            "source": SOURCE,
            "type": PRODUTO_ANALISADO_TYPE,
            "subject": analysis.product_id,
            "time": analysis.analyzed_at,
            "datacontenttype": "application/json",
        },
        data={
            "sku": analysis.sku,
            "status": analysis.status.value,
            "violations": [{"ruleCode": v.rule_code, "message": v.message} for v in analysis.violations],
        },
    )
    message = to_binary(event, _FORMAT, key_mapper=lambda e: e.get_subject())
    key = message.key.encode() if isinstance(message.key, str) else message.key
    return OutgoingMessage(key=key, value=message.value, headers=list(message.headers.items()))
```

`infra/messaging/kafka_analysis_result_publisher.py`:

```python
from compliance_service.core.product.model.product_analysis import ProductAnalysis
from compliance_service.infra.messaging.cloud_events import write_produto_analisado
from compliance_service.infra.messaging.message_producer import MessageProducer


class KafkaAnalysisResultPublisher:
    def __init__(self, producer: MessageProducer, topic: str) -> None:
        self._producer = producer
        self._topic = topic

    async def publish(self, analysis: ProductAnalysis) -> None:
        message = write_produto_analisado(analysis)
        await self._producer.send_and_wait(self._topic, value=message.value, key=message.key, headers=message.headers)
```

`infra/messaging/dead_letter.py`:

```python
from compliance_service.infra.messaging.kafka_record import KafkaRecord
from compliance_service.infra.messaging.message_producer import MessageProducer


class DeadLetterPublisher:
    def __init__(self, producer: MessageProducer, topic: str) -> None:
        self._producer = producer
        self._topic = topic

    async def send(self, record: KafkaRecord, reason: str) -> None:
        headers = [(name, value) for name, value in record.headers if value is not None]
        headers += [
            ("dlq-original-topic", record.topic.encode()),
            ("dlq-original-partition", str(record.partition).encode()),
            ("dlq-original-offset", str(record.offset).encode()),
            ("dlq-reason", reason.encode()),
        ]
        await self._producer.send_and_wait(self._topic, value=record.value, key=record.key, headers=headers)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `uv run pytest tests/infra/messaging -v && uv run ruff check && uv run ruff format --check`
Expected: all pass; ruff clean.

- [ ] **Step 6: Commit**

```bash
git add src/compliance_service/infra/messaging tests/infra/messaging
git commit -m "feat(compliance): adiciona leitura e publicação de eventos no formato cloudevents binário

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Unit of work and ProductCreatedConsumer

**Files:**
- Create: `infra/messaging/unit_of_work.py`, `infra/messaging/product_created_consumer.py`
- Test: `tests/infra/messaging/test_product_created_consumer.py`

**Interfaces:**
- Consumes: `read_product_created`, `UnprocessableMessageError`, `DeadLetterPublisher`, `KafkaRecord` (Task 7); `InboxStore` (Task 6); `AnalyzeProductPort` (Task 4); `DomainError` (Task 2); the `producer` and `make_record` fixtures and `TRACEPARENT` (Task 7 conftest).
- Produces:
  - `MessageUnitOfWork(Protocol)` with attributes `inbox: InboxStore` and `analyze_product: AnalyzeProductPort` and `async commit() -> None`, plus `UnitOfWorkFactory = Callable[[], AbstractAsyncContextManager[MessageUnitOfWork]]`, in `compliance_service.infra.messaging.unit_of_work`. Leaving the context without `commit()` discards the work.
  - `KafkaConsumer(Protocol)` with `async getone() -> KafkaRecord` and `async commit(offsets: dict[TopicPartition, int]) -> None`
  - `ProductCreatedConsumer(consumer, unit_of_work: UnitOfWorkFactory, dead_letter: DeadLetterPublisher, *, initial_backoff: float = 1.0, max_backoff: float = 30.0, sleep=asyncio.sleep)` with `async run() -> None` (loops forever) and `async process(record) -> None`, in `...infra.messaging.product_created_consumer`

- [ ] **Step 1: Write the failing test**

`tests/infra/messaging/test_product_created_consumer.py`:

```python
import json
from contextlib import asynccontextmanager
from datetime import UTC, datetime

import pytest
from aiokafka import TopicPartition
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from compliance_service.core.product.model.compliance_report import ComplianceReport
from compliance_service.core.product.model.product_analysis import ProductAnalysis
from compliance_service.infra.messaging.dead_letter import DeadLetterPublisher
from compliance_service.infra.messaging.product_created_consumer import ProductCreatedConsumer

NOW = datetime(2026, 10, 15, 12, 0, tzinfo=UTC)


class FakeAnalyzeProduct:
    def __init__(self, failures: int = 0) -> None:
        self.failures = failures
        self.analyzed = []

    async def analyze(self, product):
        if self.failures:
            self.failures -= 1
            raise RuntimeError("database unavailable")
        self.analyzed.append(product)
        return ProductAnalysis.of(product, ComplianceReport(), NOW)


class FakeInbox:
    def __init__(self, processed: set[str], pending: set[str]) -> None:
        self._processed = processed
        self._pending = pending

    async def was_processed(self, event_id):
        return event_id in self._processed

    async def mark_processed(self, event_id, event_type):
        self._pending.add(event_id)


class FakeUnitOfWork:
    def __init__(self, processed: set[str], analyze_product: FakeAnalyzeProduct) -> None:
        self._processed = processed
        self._pending: set[str] = set()
        self.inbox = FakeInbox(processed, self._pending)
        self.analyze_product = analyze_product

    async def commit(self):
        self._processed |= self._pending


class FakeKafkaConsumer:
    def __init__(self) -> None:
        self.commits = []

    async def commit(self, offsets):
        self.commits.append(offsets)


class Harness:
    def __init__(self, producer, failures: int = 0, processed: set[str] | None = None) -> None:
        self.processed = processed if processed is not None else set()
        self.analyze_product = FakeAnalyzeProduct(failures)
        self.kafka = FakeKafkaConsumer()
        self.producer = producer
        self.sleeps: list[float] = []

        @asynccontextmanager
        async def unit_of_work():
            yield FakeUnitOfWork(self.processed, self.analyze_product)

        async def sleep(seconds):
            self.sleeps.append(seconds)

        self.consumer = ProductCreatedConsumer(
            self.kafka,
            unit_of_work,
            DeadLetterPublisher(producer, "compliance.product-created.dlq"),
            sleep=sleep,
        )


EXPECTED_COMMIT = {TopicPartition("catalog.product.created.v1", 1): 8}


async def test_analyses_a_new_product(producer, make_record):
    harness = Harness(producer)

    await harness.consumer.process(make_record())

    assert [p.sku for p in harness.analyze_product.analyzed] == ["SKU-1"]
    assert harness.processed == {"e-1"}
    assert harness.kafka.commits == [EXPECTED_COMMIT]
    assert producer.sent == []


async def test_skips_an_event_already_processed(producer, make_record):
    harness = Harness(producer, processed={"e-1"})

    await harness.consumer.process(make_record())

    assert harness.analyze_product.analyzed == []
    assert harness.kafka.commits == [EXPECTED_COMMIT]


async def test_sends_an_unprocessable_message_to_the_dead_letter_topic(producer, make_record):
    harness = Harness(producer)

    await harness.consumer.process(make_record(event_type="catalog.product.approved.v1"))

    [message] = producer.sent
    assert message.topic == "compliance.product-created.dlq"
    assert dict(message.headers)["dlq-reason"].startswith(b"Unexpected event type")
    assert harness.analyze_product.analyzed == []
    assert harness.processed == set()
    assert harness.kafka.commits == [EXPECTED_COMMIT]


async def test_sends_a_product_breaking_domain_rules_to_the_dead_letter_topic(producer, make_record):
    harness = Harness(producer)
    value = json.dumps({**json.loads(make_record().value), "price": -1}).encode()

    await harness.consumer.process(make_record(value=value))

    [message] = producer.sent
    assert dict(message.headers)["dlq-reason"] == b"price must not be negative."
    assert harness.kafka.commits == [EXPECTED_COMMIT]


async def test_ignores_headers_without_value(producer, make_record):
    harness = Harness(producer)
    record = make_record()
    record.headers.append(("x-empty", None))

    await harness.consumer.process(record)

    assert harness.processed == {"e-1"}


async def test_retries_a_transient_failure_without_losing_the_message(producer, make_record):
    harness = Harness(producer, failures=1)

    await harness.consumer.process(make_record())

    assert harness.sleeps == [1.0]
    assert len(harness.analyze_product.analyzed) == 1
    assert harness.processed == {"e-1"}
    assert harness.kafka.commits == [EXPECTED_COMMIT]


async def test_backs_off_exponentially_up_to_the_cap(producer, make_record):
    harness = Harness(producer, failures=7)

    await harness.consumer.process(make_record())

    assert harness.sleeps == [1.0, 2.0, 4.0, 8.0, 16.0, 30.0, 30.0]


@pytest.fixture(scope="module")
def spans():
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    return exporter


async def test_continues_the_trace_from_the_message(spans, producer, make_record):
    await Harness(producer).consumer.process(make_record())

    [span] = [s for s in spans.get_finished_spans() if s.name == "catalog.product.created.v1 process"]
    assert span.kind is trace.SpanKind.CONSUMER
    assert format(span.context.trace_id, "032x") == "0af7651916cd43dd8448eb211c80319c"
    assert format(span.parent.span_id, "016x") == "b7ad6b7169203331"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run pytest tests/infra/messaging/test_product_created_consumer.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'compliance_service.infra.messaging.product_created_consumer'`.

- [ ] **Step 3: Implement**

`infra/messaging/unit_of_work.py`:

```python
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from typing import Protocol

from compliance_service.core.product.port.in_.analyze_product_port import AnalyzeProductPort
from compliance_service.infra.messaging.inbox_store import InboxStore


class MessageUnitOfWork(Protocol):
    """Everything one message touches, in one transaction. Leaving it without commit() discards the work."""

    inbox: InboxStore
    analyze_product: AnalyzeProductPort

    async def commit(self) -> None: ...


UnitOfWorkFactory = Callable[[], AbstractAsyncContextManager[MessageUnitOfWork]]
```

`infra/messaging/product_created_consumer.py`:

```python
import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Protocol

from aiokafka import TopicPartition
from opentelemetry import metrics, propagate, trace

from compliance_service.core.shared.domain.errors import DomainError
from compliance_service.infra.messaging.cloud_events import UnprocessableMessageError, read_product_created
from compliance_service.infra.messaging.dead_letter import DeadLetterPublisher
from compliance_service.infra.messaging.kafka_record import KafkaRecord
from compliance_service.infra.messaging.unit_of_work import UnitOfWorkFactory

logger = logging.getLogger(__name__)
_tracer = trace.get_tracer(__name__)
_dead_lettered = metrics.get_meter(__name__).create_counter(
    "compliance.messages.dead_lettered", description="Messages sent to the dead letter topic"
)


class KafkaConsumer(Protocol):
    async def getone(self) -> KafkaRecord: ...

    async def commit(self, offsets: dict[TopicPartition, int]) -> None: ...


class ProductCreatedConsumer:
    def __init__(
        self,
        consumer: KafkaConsumer,
        unit_of_work: UnitOfWorkFactory,
        dead_letter: DeadLetterPublisher,
        *,
        initial_backoff: float = 1.0,
        max_backoff: float = 30.0,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._consumer = consumer
        self._unit_of_work = unit_of_work
        self._dead_letter = dead_letter
        self._initial_backoff = initial_backoff
        self._max_backoff = max_backoff
        self._sleep = sleep

    async def run(self) -> None:
        while True:
            await self.process(await self._consumer.getone())

    # A message that can never succeed goes to the dead letter topic. Anything else is retried in
    # place, so the offset is committed only once the message is handled.
    async def process(self, record: KafkaRecord) -> None:
        backoff = self._initial_backoff
        while True:
            try:
                await self._handle(record)
                break
            except Exception:
                logger.exception("Failed to process %s; retrying in %.1fs", _position(record), backoff)
                await self._sleep(backoff)
                backoff = min(backoff * 2, self._max_backoff)
        await self._consumer.commit({TopicPartition(record.topic, record.partition): record.offset + 1})

    async def _handle(self, record: KafkaRecord) -> None:
        carrier = {name: value.decode(errors="replace") for name, value in record.headers if value is not None}
        with _tracer.start_as_current_span(
            f"{record.topic} process",
            context=propagate.extract(carrier),
            kind=trace.SpanKind.CONSUMER,
            attributes={
                "messaging.system": "kafka",
                "messaging.destination.name": record.topic,
                "messaging.kafka.offset": record.offset,
            },
        ):
            try:
                event = read_product_created(record.headers, record.key, record.value)
                async with self._unit_of_work() as unit_of_work:
                    if await unit_of_work.inbox.was_processed(event.event_id):
                        logger.info("Event %s already processed; skipping", event.event_id)
                        return
                    analysis = await unit_of_work.analyze_product.analyze(event.product)
                    await unit_of_work.inbox.mark_processed(event.event_id, event.event_type)
                    await unit_of_work.commit()
                logger.info("Product %s analysed as %s", analysis.sku, analysis.status.value)
            except (UnprocessableMessageError, DomainError) as err:
                logger.warning("Sending %s to the dead letter topic: %s", _position(record), err)
                await self._dead_letter.send(record, str(err))
                _dead_lettered.add(1, {"reason": type(err).__name__})


def _position(record: KafkaRecord) -> str:
    return f"{record.topic}[{record.partition}]@{record.offset}"
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/infra/messaging -v && uv run ruff check && uv run ruff format --check`
Expected: all pass; ruff clean.

- [ ] **Step 5: Commit**

```bash
git add src/compliance_service/infra/messaging tests/infra/messaging/test_product_created_consumer.py
git commit -m "feat(compliance): adiciona consumidor de produtos criados com idempotência e DLQ

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Telemetry setup and metrics decorator

**Files:**
- Create: `infra/observability/__init__.py`, `infra/observability/telemetry.py`, `infra/observability/metered_analyze_product.py`
- Test: `tests/infra/observability/test_metered_analyze_product.py`

**Interfaces:**
- Consumes: `AnalyzeProductPort` (Task 4); `Settings` (Task 5).
- Produces:
  - `Telemetry` with `shutdown() -> None`, `setup_telemetry(settings: Settings) -> Telemetry`, `instrument_app(app: FastAPI) -> None` and `instrument_engine(engine: AsyncEngine) -> None`, in `compliance_service.infra.observability.telemetry`
  - `AnalysisInstruments` (`analyses: Counter`, `violations: Counter`, `duration: Histogram`) with classmethod `create(meter: Meter) -> AnalysisInstruments`, plus `MeteredAnalyzeProduct(inner: AnalyzeProductPort, instruments: AnalysisInstruments)` implementing `AnalyzeProductPort`, in `...infra.observability.metered_analyze_product`

- [ ] **Step 1: Write the failing test**

`tests/infra/observability/test_metered_analyze_product.py`:

```python
from datetime import UTC, datetime

import pytest
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import InMemoryMetricReader

from compliance_service.core.product.model.compliance_report import ComplianceReport
from compliance_service.core.product.model.product_analysis import ProductAnalysis
from compliance_service.core.product.model.violation import Violation
from compliance_service.infra.observability.metered_analyze_product import (
    AnalysisInstruments,
    MeteredAnalyzeProduct,
)

NOW = datetime(2026, 10, 15, 12, 0, tzinfo=UTC)


class StubAnalyzeProduct:
    def __init__(self, violations=(), error=None):
        self._violations = violations
        self._error = error

    async def analyze(self, product):
        if self._error:
            raise self._error
        report = ComplianceReport()
        for violation in self._violations:
            report.add(violation)
        return ProductAnalysis.of(product, report, NOW)


@pytest.fixture
def reader():
    return InMemoryMetricReader()


@pytest.fixture
def instruments(reader):
    return AnalysisInstruments.create(MeterProvider(metric_readers=[reader]).get_meter("test"))


def points(reader):
    data = reader.get_metrics_data()
    if data is None:
        return {}
    return {
        metric.name: list(metric.data.data_points)
        for resource in data.resource_metrics
        for scope in resource.scope_metrics
        for metric in scope.metrics
    }


async def test_returns_the_wrapped_result(instruments, make_product):
    analysis = await MeteredAnalyzeProduct(StubAnalyzeProduct(), instruments).analyze(make_product())

    assert analysis.sku == "SKU-1"


async def test_counts_analyses_and_violations(reader, instruments, make_product):
    violations = (Violation("PRICE_CEILING", "a"), Violation("DESCRIPTION_REQUIRED", "b"))

    await MeteredAnalyzeProduct(StubAnalyzeProduct(violations), instruments).analyze(make_product())

    recorded = points(reader)
    [analyses] = recorded["compliance.analyses"]
    assert (dict(analyses.attributes), analyses.value) == ({"status": "REJECTED"}, 1)
    assert sorted(p.attributes["rule_code"] for p in recorded["compliance.rule.violations"]) == [
        "DESCRIPTION_REQUIRED",
        "PRICE_CEILING",
    ]
    [duration] = recorded["compliance.analysis.duration"]
    assert duration.count == 1


async def test_records_nothing_when_the_analysis_fails(reader, instruments, make_product):
    metered = MeteredAnalyzeProduct(StubAnalyzeProduct(error=RuntimeError("down")), instruments)

    with pytest.raises(RuntimeError):
        await metered.analyze(make_product())

    assert "compliance.analyses" not in points(reader)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run pytest tests/infra/observability -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'compliance_service.infra.observability'`.

- [ ] **Step 3: Implement the metrics decorator**

`infra/observability/__init__.py`: empty.

`infra/observability/metered_analyze_product.py`:

```python
import time
from dataclasses import dataclass

from opentelemetry.metrics import Counter, Histogram, Meter

from compliance_service.core.product.model.product import Product
from compliance_service.core.product.model.product_analysis import ProductAnalysis
from compliance_service.core.product.port.in_.analyze_product_port import AnalyzeProductPort


@dataclass(frozen=True)
class AnalysisInstruments:
    analyses: Counter
    violations: Counter
    duration: Histogram

    @classmethod
    def create(cls, meter: Meter) -> "AnalysisInstruments":
        return cls(
            analyses=meter.create_counter("compliance.analyses", description="Product analyses by status"),
            violations=meter.create_counter("compliance.rule.violations", description="Violations by rule"),
            duration=meter.create_histogram(
                "compliance.analysis.duration", unit="s", description="Time to analyse a product"
            ),
        )


class MeteredAnalyzeProduct:
    """Records analysis metrics around the core port, so the core stays free of OpenTelemetry."""

    def __init__(self, inner: AnalyzeProductPort, instruments: AnalysisInstruments) -> None:
        self._inner = inner
        self._instruments = instruments

    async def analyze(self, product: Product) -> ProductAnalysis:
        started = time.perf_counter()
        analysis = await self._inner.analyze(product)
        self._instruments.duration.record(time.perf_counter() - started)
        self._instruments.analyses.add(1, {"status": analysis.status.value})
        for violation in analysis.violations:
            self._instruments.violations.add(1, {"rule_code": violation.rule_code})
        return analysis
```

- [ ] **Step 4: Implement telemetry setup**

`infra/observability/telemetry.py`:

```python
import logging
from dataclasses import dataclass

from fastapi import FastAPI
from opentelemetry import _logs, metrics, trace
from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.aiokafka import AIOKafkaInstrumentor
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.logging import LoggingInstrumentor
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
from opentelemetry.sdk._logs import LoggerProvider
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import SERVICE_NAME, Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from sqlalchemy.ext.asyncio import AsyncEngine

from compliance_service.infra.config.settings import Settings

LOG_FORMAT = "%(asctime)s %(levelname)s [%(name)s] [trace_id=%(otelTraceID)s span_id=%(otelSpanID)s] %(message)s"


@dataclass(frozen=True)
class Telemetry:
    tracer_provider: TracerProvider
    meter_provider: MeterProvider
    logger_provider: LoggerProvider

    def shutdown(self) -> None:
        self.tracer_provider.shutdown()
        self.meter_provider.shutdown()
        self.logger_provider.shutdown()


def setup_telemetry(settings: Settings) -> Telemetry:
    """Must run before the app is built, so instrumentations patch aiokafka and logging first."""
    resource = Resource.create({SERVICE_NAME: settings.otel_service_name})
    collector = settings.otel_collector_url.rstrip("/")

    tracer_provider = TracerProvider(resource=resource)
    tracer_provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=f"{collector}/v1/traces")))
    trace.set_tracer_provider(tracer_provider)

    meter_provider = MeterProvider(
        resource=resource,
        metric_readers=[PeriodicExportingMetricReader(OTLPMetricExporter(endpoint=f"{collector}/v1/metrics"))],
    )
    metrics.set_meter_provider(meter_provider)

    logger_provider = LoggerProvider(resource=resource)
    logger_provider.add_log_record_processor(BatchLogRecordProcessor(OTLPLogExporter(endpoint=f"{collector}/v1/logs")))
    _logs.set_logger_provider(logger_provider)

    # Adds trace_id/span_id to every record and attaches the OTLP handler to the root logger.
    LoggingInstrumentor().instrument(inject_trace_context=True)
    _configure_console_logging(settings.log_level)
    AIOKafkaInstrumentor().instrument()

    return Telemetry(tracer_provider, meter_provider, logger_provider)


def instrument_app(app: FastAPI) -> None:
    FastAPIInstrumentor.instrument_app(app)


def instrument_engine(engine: AsyncEngine) -> None:
    SQLAlchemyInstrumentor().instrument(engine=engine.sync_engine)


def _configure_console_logging(level: str) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter(LOG_FORMAT))
    root = logging.getLogger()
    root.addHandler(handler)
    root.setLevel(level.upper())
```

- [ ] **Step 5: Smoke-test the setup (no collector needed)**

Run: `uv run python -W error::DeprecationWarning -c "from compliance_service.infra.config.settings import Settings; from compliance_service.infra.observability.telemetry import setup_telemetry; import logging; t = setup_telemetry(Settings(_env_file=None)); logging.getLogger('smoke').info('hello'); t.shutdown()"`
Expected: one console line like `... INFO [smoke] [trace_id=0 span_id=0] hello`, with no `DeprecationWarning` traceback. Export errors to `localhost:4318` are fine when the collector is down.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `uv run pytest -v && uv run ruff check && uv run ruff format --check`
Expected: all pass; ruff clean.

- [ ] **Step 7: Commit**

```bash
git add src/compliance_service/infra/observability tests/infra/observability
git commit -m "feat(compliance): configura opentelemetry com traces, métricas e logs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Wiring, topics, docs and end-to-end check

**Files:**
- Create: `infra/system_clock.py`, `infra/persistence/sqlalchemy_unit_of_work.py`, `infra/product_factory.py`
- Modify: `src/compliance_service/main.py` (full rewrite)
- Modify: `../docker/kafka/create-topics.sh`
- Modify: `compliance-service/CLAUDE.md` (full rewrite), `../CLAUDE.md`
- Test: `tests/infra/test_product_factory.py`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `SystemClock` (`now() -> datetime` in UTC)
  - `SqlAlchemyUnitOfWork(session, inbox, analyze_product)` with `async commit()`
  - `build_rules(settings: Settings) -> ComplianceHandler`
  - `build_unit_of_work_factory(session_factory, rules, publisher, clock, instruments) -> UnitOfWorkFactory`
  - `compliance_service.main:app`

- [ ] **Step 1: Write the failing test**

`tests/infra/test_product_factory.py`:

```python
from datetime import UTC, datetime
from decimal import Decimal

from opentelemetry.sdk.metrics import MeterProvider
from sqlalchemy import select

from compliance_service.core.product.model.compliance_report import ComplianceReport
from compliance_service.infra.config.settings import Settings
from compliance_service.infra.observability.metered_analyze_product import AnalysisInstruments
from compliance_service.infra.persistence.tables import processed_events, product_analyses
from compliance_service.infra.product_factory import build_rules, build_unit_of_work_factory

NOW = datetime(2026, 10, 15, 12, 0, tzinfo=UTC)


class FixedClock:
    def now(self):
        return NOW


class RecordingPublisher:
    def __init__(self):
        self.published = []

    async def publish(self, analysis):
        self.published.append(analysis)


def rule_codes(settings, product):
    return [v.rule_code for v in build_rules(settings).handle(product, ComplianceReport()).violations]


def test_prohibited_terms_block_the_other_rules(make_product):
    product = make_product(name="Pistola", price=Decimal("999999"), description="")

    assert rule_codes(Settings(_env_file=None), product) == ["PROHIBITED_TERMS"]


def test_non_blocking_rules_report_together(make_product):
    product = make_product(price=Decimal("999999"), description="curta")

    assert rule_codes(Settings(_env_file=None), product) == ["PRICE_CEILING", "DESCRIPTION_REQUIRED"]


def test_rules_use_the_configured_limits(make_product):
    settings = Settings(_env_file=None, price_ceiling=Decimal("10"), description_min_length=1)

    assert rule_codes(settings, make_product(price=Decimal("11"))) == ["PRICE_CEILING"]


async def test_a_unit_of_work_stores_the_analysis_and_the_event_together(session_factory, make_product):
    publisher = RecordingPublisher()
    open_unit_of_work = build_unit_of_work_factory(
        session_factory,
        build_rules(Settings(_env_file=None)),
        publisher,
        FixedClock(),
        AnalysisInstruments.create(MeterProvider().get_meter("test")),
    )

    async with open_unit_of_work() as unit_of_work:
        await unit_of_work.analyze_product.analyze(make_product())
        await unit_of_work.inbox.mark_processed("e-1", "catalog.product.created.v1")
        await unit_of_work.commit()

    async with session_factory() as session:
        analyses = (await session.execute(select(product_analyses))).all()
        events = (await session.execute(select(processed_events.c.event_id))).scalars().all()

    assert [a.status for a in analyses] == ["APPROVED"]
    assert events == ["e-1"]
    assert len(publisher.published) == 1


async def test_a_unit_of_work_left_without_commit_stores_nothing(session_factory, make_product):
    open_unit_of_work = build_unit_of_work_factory(
        session_factory,
        build_rules(Settings(_env_file=None)),
        RecordingPublisher(),
        FixedClock(),
        AnalysisInstruments.create(MeterProvider().get_meter("test")),
    )

    async with open_unit_of_work() as unit_of_work:
        await unit_of_work.analyze_product.analyze(make_product())
        await unit_of_work.inbox.mark_processed("e-1", "catalog.product.created.v1")

    async with session_factory() as session:
        assert (await session.execute(select(product_analyses))).all() == []
```

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run pytest tests/infra/test_product_factory.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'compliance_service.infra.product_factory'`.

- [ ] **Step 3: Implement the wiring**

`infra/system_clock.py`:

```python
from datetime import UTC, datetime


class SystemClock:
    def now(self) -> datetime:
        return datetime.now(UTC)
```

`infra/persistence/sqlalchemy_unit_of_work.py`:

```python
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from compliance_service.core.product.port.in_.analyze_product_port import AnalyzeProductPort
from compliance_service.infra.messaging.inbox_store import InboxStore


@dataclass(frozen=True)
class SqlAlchemyUnitOfWork:
    session: AsyncSession
    inbox: InboxStore
    analyze_product: AnalyzeProductPort

    async def commit(self) -> None:
        await self.session.commit()
```

`infra/product_factory.py`:

```python
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from compliance_service.core.product.model.rules.compliance_handler import ComplianceHandler, build_chain
from compliance_service.core.product.model.rules.description_required_rule import DescriptionRequiredRule
from compliance_service.core.product.model.rules.price_ceiling_rule import PriceCeilingRule
from compliance_service.core.product.model.rules.prohibited_terms_rule import ProhibitedTermsRule
from compliance_service.core.product.port.out.analysis_result_publisher import AnalysisResultPublisher
from compliance_service.core.product.port.out.clock import Clock
from compliance_service.core.product.product_facade import ProductFacade
from compliance_service.infra.config.settings import Settings
from compliance_service.infra.messaging.inbox_store import SqlAlchemyInboxStore
from compliance_service.infra.messaging.unit_of_work import MessageUnitOfWork, UnitOfWorkFactory
from compliance_service.infra.observability.metered_analyze_product import AnalysisInstruments, MeteredAnalyzeProduct
from compliance_service.infra.persistence.sqlalchemy_product_analysis_repository import (
    SqlAlchemyProductAnalysisRepository,
)
from compliance_service.infra.persistence.sqlalchemy_unit_of_work import SqlAlchemyUnitOfWork


def build_rules(settings: Settings) -> ComplianceHandler:
    return build_chain(
        ProhibitedTermsRule(),
        PriceCeilingRule(settings.price_ceiling),
        DescriptionRequiredRule(settings.description_min_length),
    )


def build_unit_of_work_factory(
    session_factory: async_sessionmaker[AsyncSession],
    rules: ComplianceHandler,
    publisher: AnalysisResultPublisher,
    clock: Clock,
    instruments: AnalysisInstruments,
) -> UnitOfWorkFactory:
    @asynccontextmanager
    async def open_unit_of_work() -> AsyncIterator[MessageUnitOfWork]:
        async with session_factory() as session:
            facade = ProductFacade(rules, SqlAlchemyProductAnalysisRepository(session), publisher, clock)
            yield SqlAlchemyUnitOfWork(
                session=session,
                inbox=SqlAlchemyInboxStore(session),
                analyze_product=MeteredAnalyzeProduct(facade, instruments),
            )

    return open_unit_of_work
```

`src/compliance_service/main.py`:

```python
import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress

import uvicorn
from aiokafka import AIOKafkaConsumer, AIOKafkaProducer
from fastapi import FastAPI
from opentelemetry import metrics

from compliance_service.infra.config.settings import Settings
from compliance_service.infra.http.app import create_app
from compliance_service.infra.messaging.dead_letter import DeadLetterPublisher
from compliance_service.infra.messaging.kafka_analysis_result_publisher import KafkaAnalysisResultPublisher
from compliance_service.infra.messaging.product_created_consumer import ProductCreatedConsumer
from compliance_service.infra.observability.metered_analyze_product import AnalysisInstruments
from compliance_service.infra.observability.telemetry import instrument_app, instrument_engine, setup_telemetry
from compliance_service.infra.persistence.database import create_engine, create_session_factory
from compliance_service.infra.product_factory import build_rules, build_unit_of_work_factory
from compliance_service.infra.system_clock import SystemClock

CONSUMER_GROUP = "compliance-service"

settings = Settings()
telemetry = setup_telemetry(settings)
logger = logging.getLogger(__name__)


def _log_consumer_exit(task: asyncio.Task) -> None:
    if not task.cancelled() and task.exception():
        logger.error("Product consumer stopped", exc_info=task.exception())


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    engine = create_engine(settings.database_url)
    instrument_engine(engine)
    producer = AIOKafkaProducer(bootstrap_servers=settings.kafka_bootstrap_servers, acks="all")
    kafka_consumer = AIOKafkaConsumer(
        settings.product_created_topic,
        bootstrap_servers=settings.kafka_bootstrap_servers,
        group_id=CONSUMER_GROUP,
        enable_auto_commit=False,
        auto_offset_reset="earliest",
    )
    await producer.start()
    await kafka_consumer.start()

    consumer = ProductCreatedConsumer(
        kafka_consumer,
        build_unit_of_work_factory(
            create_session_factory(engine),
            build_rules(settings),
            KafkaAnalysisResultPublisher(producer, settings.produto_analisado_topic),
            SystemClock(),
            AnalysisInstruments.create(metrics.get_meter("compliance_service")),
        ),
        DeadLetterPublisher(producer, settings.product_created_dlq_topic),
    )
    task = asyncio.create_task(consumer.run())
    task.add_done_callback(_log_consumer_exit)
    logger.info("Consuming %s", settings.product_created_topic)

    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
        await kafka_consumer.stop()
        await producer.stop()
        await engine.dispose()
        telemetry.shutdown()


app = create_app(lifespan)
instrument_app(app)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=settings.port)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest -v && uv run ruff check && uv run ruff format --check`
Expected: all pass; ruff clean. (`tests/infra/http/test_health.py` still uses `create_app()` without a lifespan, so importing `main` is never needed in tests.)

- [ ] **Step 5: Add the DLQ topic**

In `../docker/kafka/create-topics.sh`, after the catalog block and before the `--list` call, add:

```sh
# compliance-service
create compliance.product-created.dlq 1 retention.ms=1209600000 # 14 days to inspect and replay
```

Run: `docker compose -f ../compose.yaml up -d kafka kafka-init && docker logs -f kafka-init 2>&1 | tail -8`
Expected: the topic list includes `compliance.product-created.dlq`.

- [ ] **Step 6: End-to-end check against real infra**

```bash
docker compose -f ../compose.yaml --profile obs up -d compliance-db kafka kafka-init otel-collector tempo loki prometheus grafana
uv run alembic upgrade head
uv run python -m compliance_service.main   # leave running in a second terminal
```

Write `$SCRATCHPAD/send_product.py` (the scratchpad directory, not the repo):

```python
import asyncio
import json
import sys
import uuid

from aiokafka import AIOKafkaProducer


async def main(name: str) -> None:
    producer = AIOKafkaProducer(bootstrap_servers="localhost:9092")
    await producer.start()
    product_id = str(uuid.uuid4())
    headers = [
        ("ce_specversion", b"1.0"),
        ("ce_id", str(uuid.uuid4()).encode()),
        ("ce_source", b"catalog-service"),
        ("ce_type", b"catalog.product.created.v1"),
        ("ce_subject", product_id.encode()),
        ("content-type", b"application/json"),
    ]
    data = {"productId": product_id, "sku": f"E2E-{product_id[:8]}", "name": name,
            "description": "Produto de teste ponta a ponta", "price": 49.9, "stock": 3}
    await producer.send_and_wait("catalog.product.created.v1", json.dumps(data).encode(), product_id.encode(), headers=headers)
    await producer.stop()


asyncio.run(main(sys.argv[1]))
```

Run: `uv run python $SCRATCHPAD/send_product.py "Cadeira gamer" && uv run python $SCRATCHPAD/send_product.py "Pistola de pressão"`

Check:
- `docker exec kafka /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic produto.analisado.v1 --from-beginning --property print.headers=true --timeout-ms 5000`. Expected: two records with `ce_type:produto.analisado.v1`; the first value has `"status": "APPROVED"`, the second `"status": "REJECTED"` with `PROHIBITED_TERMS`.
- `docker exec compliance-db psql -U compliance -c "select sku, status from product_analyses; select count(*) from processed_events;"`. Expected: two analyses, `count = 2`.
- The service console shows `Product E2E-... analysed as APPROVED` with a non-zero `trace_id`. In Grafana (http://localhost:3000), the Tempo search for service `compliance-service` shows a `catalog.product.created.v1 process` span, and Loki shows the same log lines.

Stop the service with Ctrl+C. Expected: a clean shutdown with no traceback.

- [ ] **Step 7: Update the docs**

Rewrite `compliance-service/CLAUDE.md`:

````markdown
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`compliance-service` is one service in the "omni-market" monorepo. It simulates compliance checks (standards, laws, restrictions) on products: it consumes `catalog.product.created.v1`, runs the product through a chain of rules, and publishes `APPROVED`/`REJECTED` to `produto.analisado.v1`, which `catalog-service` consumes.

Shared infrastructure and monorepo-wide conventions are described in `../CLAUDE.md`. `../catalog-service/CLAUDE.md` is the reference implementation of the same architecture in TypeScript. The design is in `../docs/superpowers/specs/2026-10-15-compliance-product-analysis-design.md`.

Stack: Python 3.13 (pinned in `.python-version`), uv, FastAPI, aiokafka, cloudevents, SQLAlchemy 2 async + asyncpg, Alembic, pydantic-settings, OpenTelemetry.

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
- Custom metrics live in `infra` only: `MeteredAnalyzeProduct` (a decorator around `AnalyzeProductPort`) records `compliance.analyses`, `compliance.rule.violations` and `compliance.analysis.duration`; the consumer records `compliance.messages.dead_lettered`.
````

In `../CLAUDE.md`, under "Shared infrastructure", after the Kafka paragraph, add:

```markdown
**Postgres**: one container per service. `catalog-db` on localhost:5432 (`catalog`/`catalog`), `compliance-db` on localhost:5433 (`compliance`/`compliance`).
```

- [ ] **Step 8: Final verification and commit**

Run: `uv run pytest && uv run ruff check && uv run ruff format --check && git status --short`
Expected: all pass; ruff clean; only the intended files changed.

```bash
git add src/compliance_service tests/infra/test_product_factory.py CLAUDE.md ../CLAUDE.md ../docker/kafka/create-topics.sh
git commit -m "feat(compliance): integra consumidor, banco e telemetria na aplicação

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
