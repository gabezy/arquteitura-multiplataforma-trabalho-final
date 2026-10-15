from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal
from uuid import uuid4

import pydantic
from cloudevents.core.bindings.kafka import KafkaMessage, from_binary, to_binary
from cloudevents.core.exceptions import BaseCloudEventException
from cloudevents.core.formats.json import JSONFormat
from cloudevents.core.v1.event import CloudEvent

from compliance_service.core.product.model.product import Product
from compliance_service.core.product.model.product_analysis import ProductAnalysis

PRODUCT_CREATED_TYPE = "catalog.product.created.v1"
PRODUTO_ANALISADO_TYPE = "produto.analisado.v1"
SOURCE = "compliance-service"

_FORMAT = JSONFormat()


class UnprocessableMessageError(Exception):
    """The message can never be processed, so retrying it is pointless."""


class _ProductCreatedData(pydantic.BaseModel):
    """Contract published by catalog-service. Translating it here keeps that vocabulary out of the core."""

    product_id: str = pydantic.Field(alias="productId")
    sku: str
    name: str
    description: str
    price: Decimal
    stock: int


@dataclass(frozen=True)
class ProductCreatedEvent:
    event_id: str
    event_type: str
    product: Product


@dataclass(frozen=True)
class OutgoingMessage:
    key: bytes
    value: bytes
    headers: list[tuple[str, bytes]]


def read_product_created(
    headers: Sequence[tuple[str, bytes | None]], key: bytes | None, value: bytes | None
) -> ProductCreatedEvent:
    message = KafkaMessage(
        headers={name: header for name, header in headers if header is not None},
        key=key,
        value=value or b"",
    )
    try:
        event = from_binary(message, _FORMAT)
    except (BaseCloudEventException, ValueError) as err:
        raise UnprocessableMessageError(f"Invalid CloudEvent: {err}") from err

    if event.get_type() != PRODUCT_CREATED_TYPE:
        raise UnprocessableMessageError(f"Unexpected event type {event.get_type()}.")

    try:
        data = _ProductCreatedData.model_validate(event.get_data())
    except pydantic.ValidationError as err:
        raise UnprocessableMessageError(f"Invalid product data: {err}") from err

    product = Product(
        product_id=data.product_id,
        sku=data.sku,
        name=data.name,
        description=data.description,
        price=data.price,
        stock=data.stock,
    )
    return ProductCreatedEvent(event_id=event.get_id(), event_type=event.get_type(), product=product)


def write_produto_analisado(analysis: ProductAnalysis) -> OutgoingMessage:
    event = CloudEvent(
        attributes={
            "specversion": "1.0",
            "id": str(uuid4()),
            "source": SOURCE,
            "type": PRODUTO_ANALISADO_TYPE,
            "subject": analysis.product_id,
            "time": analysis.analyzed_at,
            "datacontenttype": "application/json",
        },
        data={
            "sku": analysis.sku,
            "status": analysis.status.value,
            "violations": [{"ruleCode": v.rule_code, "message": v.message} for v in analysis.violations],
        },
    )
    message = to_binary(event, _FORMAT, key_mapper=lambda e: e.get_subject())
    key = message.key.encode() if isinstance(message.key, str) else message.key
    return OutgoingMessage(key=key, value=message.value, headers=list(message.headers.items()))
