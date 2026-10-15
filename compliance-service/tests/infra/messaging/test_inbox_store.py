import pytest
from sqlalchemy.exc import IntegrityError

from compliance_service.infra.messaging.inbox_store import SqlAlchemyInboxStore


async def test_an_unknown_event_was_not_processed(session_factory):
    async with session_factory() as session:
        assert await SqlAlchemyInboxStore(session).was_processed("e-1") is False


async def test_remembers_a_processed_event(session_factory):
    async with session_factory() as session:
        await SqlAlchemyInboxStore(session).mark_processed("e-1", "catalog.product.created.v1")
        await session.commit()

    async with session_factory() as session:
        assert await SqlAlchemyInboxStore(session).was_processed("e-1") is True


async def test_rejects_marking_the_same_event_twice(session_factory):
    async with session_factory() as session:
        await SqlAlchemyInboxStore(session).mark_processed("e-1", "catalog.product.created.v1")
        await session.commit()

    async with session_factory() as session:
        with pytest.raises(IntegrityError):
            await SqlAlchemyInboxStore(session).mark_processed("e-1", "catalog.product.created.v1")


async def test_forgets_an_uncommitted_mark(session_factory):
    async with session_factory() as session:
        await SqlAlchemyInboxStore(session).mark_processed("e-1", "catalog.product.created.v1")

    async with session_factory() as session:
        assert await SqlAlchemyInboxStore(session).was_processed("e-1") is False
