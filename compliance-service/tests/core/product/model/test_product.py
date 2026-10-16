from decimal import Decimal

import pytest

from compliance_service.core.product.model.product_errors import InvalidProductError
from compliance_service.core.shared.domain.errors import ValidationError


def test_creates_a_valid_product(make_product):
    product = make_product()

    assert product.sku == "SKU-1"
    assert product.price == Decimal("899.90")


@pytest.mark.parametrize("field", ["product_id", "sku", "name"])
def test_rejects_blank_identifying_fields(make_product, field):
    with pytest.raises(InvalidProductError, match=field):
        make_product(**{field: "   "})


def test_rejects_negative_price(make_product):
    with pytest.raises(InvalidProductError, match="price"):
        make_product(price=Decimal("-0.01"))


def test_rejects_negative_stock(make_product):
    with pytest.raises(InvalidProductError, match="stock"):
        make_product(stock=-1)


def test_accepts_an_empty_description(make_product):
    assert make_product(description="").description == ""


def test_invalid_product_is_a_validation_error():
    assert issubclass(InvalidProductError, ValidationError)
