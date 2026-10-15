from decimal import Decimal

import pytest

from compliance_service.core.product.model.product import Product


@pytest.fixture
def make_product():
    def _make(**overrides) -> Product:
        fields = {
            "product_id": "p-1",
            "sku": "SKU-1",
            "name": "Cadeira de escritório",
            "description": "Cadeira ergonômica com apoio lombar",
            "price": Decimal("899.90"),
            "stock": 10,
        }
        fields.update(overrides)
        return Product(**fields)

    return _make
