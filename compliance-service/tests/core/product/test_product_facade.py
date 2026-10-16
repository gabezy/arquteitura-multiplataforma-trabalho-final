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
