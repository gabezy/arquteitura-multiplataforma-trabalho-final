from collections.abc import Sequence
from typing import Protocol


class KafkaRecord(Protocol):
    topic: str
    partition: int
    offset: int
    key: bytes | None
    value: bytes | None
    headers: Sequence[tuple[str, bytes | None]]
