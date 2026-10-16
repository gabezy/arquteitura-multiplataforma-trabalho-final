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
