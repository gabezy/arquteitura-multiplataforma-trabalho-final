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
