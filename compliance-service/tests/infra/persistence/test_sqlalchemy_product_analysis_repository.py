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
