from typing import Protocol

from compliance_service.core.product.model.product import Product
from compliance_service.core.product.model.product_analysis import ProductAnalysis


class AnalyzeProductPort(Protocol):
    async def analyze(self, product: Product) -> ProductAnalysis: ...
