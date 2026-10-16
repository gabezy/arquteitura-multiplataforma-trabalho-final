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
