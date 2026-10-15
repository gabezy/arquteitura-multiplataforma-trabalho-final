from typing import Any, Protocol


class MessageProducer(Protocol):
    async def send_and_wait(
        self,
        topic: str,
        value: bytes | None = None,
        key: bytes | None = None,
        headers: list[tuple[str, bytes]] | None = None,
    ) -> Any: ...
