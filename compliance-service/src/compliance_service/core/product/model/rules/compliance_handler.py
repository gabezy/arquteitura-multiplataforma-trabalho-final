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
