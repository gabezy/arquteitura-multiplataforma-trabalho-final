from typing import Protocol

from compliance_service.core.product.model.product_analysis import ProductAnalysis


class ProductAnalysisRepository(Protocol):
    async def save(self, analysis: ProductAnalysis) -> None: ...
