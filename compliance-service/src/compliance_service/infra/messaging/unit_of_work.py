from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from typing import Protocol

from compliance_service.core.product.port.in_.analyze_product_port import AnalyzeProductPort
from compliance_service.infra.messaging.inbox_store import InboxStore


class MessageUnitOfWork(Protocol):
    """Everything one message touches, in one transaction. Leaving it without commit() discards the work."""

    inbox: InboxStore
    analyze_product: AnalyzeProductPort

    async def commit(self) -> None: ...


UnitOfWorkFactory = Callable[[], AbstractAsyncContextManager[MessageUnitOfWork]]
