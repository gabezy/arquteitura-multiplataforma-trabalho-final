from compliance_service.infra.messaging.kafka_record import KafkaRecord
from compliance_service.infra.messaging.message_producer import MessageProducer


class DeadLetterPublisher:
    def __init__(self, producer: MessageProducer, topic: str) -> None:
        self._producer = producer
        self._topic = topic

    async def send(self, record: KafkaRecord, reason: str) -> None:
        headers = [(name, value) for name, value in record.headers if value is not None]
        headers += [
            ("dlq-original-topic", record.topic.encode()),
            ("dlq-original-partition", str(record.partition).encode()),
            ("dlq-original-offset", str(record.offset).encode()),
            ("dlq-reason", reason.encode()),
        ]
        await self._producer.send_and_wait(self._topic, value=record.value, key=record.key, headers=headers)
