import json
from dataclasses import dataclass, field

import pytest

TRACEPARENT = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"


@dataclass
class SentMessage:
    topic: str
    key: bytes | None
    value: bytes | None
    headers: list[tuple[str, bytes]]


class RecordingProducer:
    def __init__(self) -> None:
        self.sent: list[SentMessage] = []

    async def send_and_wait(self, topic, value=None, key=None, headers=None):
        self.sent.append(SentMessage(topic, key, value, list(headers or [])))


@dataclass
class FakeRecord:
    topic: str = "catalog.product.created.v1"
    partition: int = 1
    offset: int = 7
    key: bytes | None = b"p-1"
    value: bytes | None = None
    headers: list[tuple[str, bytes | None]] = field(default_factory=list)


def catalog_header_list(event_id: str = "e-1", event_type: str = "catalog.product.created.v1"):
    return [
        ("ce_specversion", b"1.0"),
        ("ce_id", event_id.encode()),
        ("ce_source", b"catalog-service"),
        ("ce_type", event_type.encode()),
        ("ce_subject", b"p-1"),
        ("ce_time", b"2026-10-15T10:00:00.000Z"),
        ("content-type", b"application/json"),
        ("traceparent", TRACEPARENT.encode()),
    ]


def catalog_value(**overrides) -> bytes:
    data = {
        "productId": "p-1",
        "sku": "SKU-1",
        "name": "Cadeira de escritório",
        "description": "Cadeira ergonômica com apoio lombar",
        "price": 899.9,
        "stock": 10,
    }
    data.update(overrides)
    return json.dumps(data).encode()


@pytest.fixture
def producer():
    return RecordingProducer()


@pytest.fixture
def catalog_headers():
    return catalog_header_list()


@pytest.fixture
def make_record():
    def _make(*, event_id: str = "e-1", event_type: str = "catalog.product.created.v1", **overrides) -> FakeRecord:
        fields = {"value": catalog_value(), "headers": catalog_header_list(event_id, event_type)}
        fields.update(overrides)
        return FakeRecord(**fields)

    return _make
