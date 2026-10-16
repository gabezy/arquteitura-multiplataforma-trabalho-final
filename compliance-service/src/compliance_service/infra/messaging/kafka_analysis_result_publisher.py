from compliance_service.core.product.model.product_analysis import ProductAnalysis
from compliance_service.infra.messaging.cloud_events import write_produto_analisado
from compliance_service.infra.messaging.message_producer import MessageProducer


class KafkaAnalysisResultPublisher:
    def __init__(self, producer: MessageProducer, topic: str) -> None:
        self._producer = producer
        self._topic = topic

    async def publish(self, analysis: ProductAnalysis) -> None:
        message = write_produto_analisado(analysis)
        await self._producer.send_and_wait(self._topic, value=message.value, key=message.key, headers=message.headers)
