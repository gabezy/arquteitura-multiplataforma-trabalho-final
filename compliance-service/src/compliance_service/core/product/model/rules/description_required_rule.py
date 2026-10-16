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
