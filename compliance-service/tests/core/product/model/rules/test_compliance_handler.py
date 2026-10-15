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
