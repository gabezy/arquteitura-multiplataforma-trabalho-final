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
