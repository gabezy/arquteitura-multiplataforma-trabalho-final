from typing import Protocol

from compliance_service.core.product.model.product_analysis import ProductAnalysis


class AnalysisResultPublisher(Protocol):
    async def publish(self, analysis: ProductAnalysis) -> None: ...
