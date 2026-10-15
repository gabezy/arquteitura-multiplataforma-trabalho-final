from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from compliance_service.core.product.port.in_.analyze_product_port import AnalyzeProductPort
from compliance_service.infra.messaging.inbox_store import InboxStore


@dataclass(frozen=True)
class SqlAlchemyUnitOfWork:
    session: AsyncSession
    inbox: InboxStore
    analyze_product: AnalyzeProductPort

    async def commit(self) -> None:
        await self.session.commit()
