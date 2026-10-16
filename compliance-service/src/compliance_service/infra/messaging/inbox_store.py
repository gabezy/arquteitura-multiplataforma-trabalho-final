from typing import Protocol

from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from compliance_service.infra.persistence.tables import processed_events


class InboxStore(Protocol):
    async def was_processed(self, event_id: str) -> bool: ...

    async def mark_processed(self, event_id: str, event_type: str) -> None: ...


class SqlAlchemyInboxStore:
    """Remembers consumed events so a redelivered message is not analysed twice."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def was_processed(self, event_id: str) -> bool:
        result = await self._session.execute(
            select(processed_events.c.event_id).where(processed_events.c.event_id == event_id)
        )
        return result.first() is not None

    async def mark_processed(self, event_id: str, event_type: str) -> None:
        await self._session.execute(insert(processed_events).values(event_id=event_id, event_type=event_type))
