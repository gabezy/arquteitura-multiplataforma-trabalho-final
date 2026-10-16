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
