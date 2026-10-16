from sqlalchemy import insert
from sqlalchemy.ext.asyncio import AsyncSession

from compliance_service.core.product.model.product_analysis import ProductAnalysis
from compliance_service.infra.persistence.tables import product_analyses


class SqlAlchemyProductAnalysisRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def save(self, analysis: ProductAnalysis) -> None:
        await self._session.execute(
            insert(product_analyses).values(
                id=analysis.id,
                product_id=analysis.product_id,
                sku=analysis.sku,
                status=analysis.status.value,
                violations=[{"ruleCode": v.rule_code, "message": v.message} for v in analysis.violations],
                analyzed_at=analysis.analyzed_at,
            )
        )
