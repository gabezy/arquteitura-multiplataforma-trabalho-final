import json
from datetime import UTC, datetime

from compliance_service.core.product.model.compliance_report import ComplianceReport
from compliance_service.core.product.model.product_analysis import ProductAnalysis
from compliance_service.infra.messaging.kafka_analysis_result_publisher import KafkaAnalysisResultPublisher


async def test_sends_the_analysis_to_the_topic(producer, make_product):
    analysis = ProductAnalysis.of(make_product(), ComplianceReport(), datetime(2026, 10, 15, tzinfo=UTC))

    await KafkaAnalysisResultPublisher(producer, "produto.analisado.v1").publish(analysis)

    [message] = producer.sent
    assert message.topic == "produto.analisado.v1"
    assert message.key == b"p-1"
    assert json.loads(message.value)["status"] == "APPROVED"
    assert ("ce_type", b"produto.analisado.v1") in message.headers
