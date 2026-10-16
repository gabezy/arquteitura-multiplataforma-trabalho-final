from dataclasses import dataclass
from decimal import Decimal

from compliance_service.core.product.model.product_errors import InvalidProductError


@dataclass(frozen=True)
class Product:
    product_id: str
    sku: str
    name: str
    description: str
    price: Decimal
    stock: int

    def __post_init__(self) -> None:
        for field_name in ("product_id", "sku", "name"):
            if not getattr(self, field_name).strip():
                raise InvalidProductError(f"{field_name} must not be blank.")
        if self.price < 0:
            raise InvalidProductError("price must not be negative.")
        if self.stock < 0:
            raise InvalidProductError("stock must not be negative.")
