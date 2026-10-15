import json
from datetime import UTC, datetime
from decimal import Decimal

import pytest

from compliance_service.core.product.model.compliance_report import ComplianceReport
from compliance_service.core.product.model.product_analysis import ProductAnalysis
from compliance_service.core.product.model.product_errors import InvalidProductError
from compliance_service.core.product.model.violation import Violation
from compliance_service.infra.messaging.cloud_events import (
    UnprocessableMessageError,
    read_product_created,
    write_produto_analisado,
)

NOW = datetime(2026, 10, 15, 12, 0, tzinfo=UTC)


def read(record):
    return read_product_created(record.headers, record.key, record.value)


class TestReadProductCreated:
    def test_reads_a_catalog_message(self, make_record):
        event = read(make_record())

        assert event.event_id == "e-1"
        assert event.event_type == "catalog.product.created.v1"
        assert event.product.product_id == "p-1"
        assert event.product.sku == "SKU-1"
        assert event.product.stock == 10

    def test_keeps_the_exact_decimal_price(self, make_record):
        record = make_record(value=json.dumps({**json.loads(make_record().value), "price": 19.99}).encode())

        assert read(record).product.price == Decimal("19.99")

    def test_accepts_an_empty_description(self, make_record):
        record = make_record(value=json.dumps({**json.loads(make_record().value), "description": ""}).encode())

        assert read(record).product.description == ""

    def test_ignores_headers_without_value(self, make_record, catalog_headers):
        record = make_record(headers=[*catalog_headers, ("x-empty", None)])

        assert read(record).event_id == "e-1"

    def test_rejects_another_event_type(self, make_record):
        with pytest.raises(UnprocessableMessageError, match="catalog.product.approved.v1"):
            read(make_record(event_type="catalog.product.approved.v1"))

    def test_rejects_a_message_without_cloud_event_headers(self, make_record):
        with pytest.raises(UnprocessableMessageError):
            read(make_record(headers=[("content-type", b"application/json")]))

    def test_rejects_invalid_json(self, make_record):
        with pytest.raises(UnprocessableMessageError):
            read(make_record(value=b"not json"))

    def test_rejects_an_empty_value(self, make_record):
        with pytest.raises(UnprocessableMessageError):
            read(make_record(value=None))

    def test_rejects_missing_fields(self, make_record):
        with pytest.raises(UnprocessableMessageError, match="sku"):
            read(make_record(value=json.dumps({"productId": "p-1"}).encode()))

    def test_lets_domain_validation_errors_through(self, make_record):
        record = make_record(value=json.dumps({**json.loads(make_record().value), "price": -1}).encode())

        with pytest.raises(InvalidProductError):
            read(record)


class TestWriteProdutoAnalisado:
    def analysis(self, make_product):
        report = ComplianceReport()
        report.add(Violation("PRICE_CEILING", "Too expensive."))
        return ProductAnalysis.of(make_product(), report, NOW)

    def test_uses_binary_mode_headers(self, make_product):
        headers = dict(write_produto_analisado(self.analysis(make_product)).headers)

        assert headers["ce_specversion"] == b"1.0"
        assert headers["ce_type"] == b"produto.analisado.v1"
        assert headers["ce_source"] == b"compliance-service"
        assert headers["ce_subject"] == b"p-1"
        assert headers["ce_time"] == b"2026-10-15T12:00:00Z"
        assert headers["content-type"] == b"application/json"

    def test_keys_by_product_id(self, make_product):
        assert write_produto_analisado(self.analysis(make_product)).key == b"p-1"

    def test_carries_the_result_catalog_expects(self, make_product):
        value = json.loads(write_produto_analisado(self.analysis(make_product)).value)

        assert value == {
            "sku": "SKU-1",
            "status": "REJECTED",
            "violations": [{"ruleCode": "PRICE_CEILING", "message": "Too expensive."}],
        }

    def test_gives_each_message_its_own_id(self, make_product):
        analysis = self.analysis(make_product)

        first = dict(write_produto_analisado(analysis).headers)["ce_id"]
        second = dict(write_produto_analisado(analysis).headers)["ce_id"]

        assert first != second
