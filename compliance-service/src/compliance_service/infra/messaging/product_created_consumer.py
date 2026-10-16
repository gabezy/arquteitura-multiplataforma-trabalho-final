import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Protocol

from aiokafka import TopicPartition
from aiokafka.errors import CommitFailedError, IllegalStateError
from opentelemetry import metrics, propagate, trace

from compliance_service.core.shared.domain.errors import DomainError
from compliance_service.infra.messaging.cloud_events import UnprocessableMessageError, read_product_created
from compliance_service.infra.messaging.dead_letter import DeadLetterPublisher
from compliance_service.infra.messaging.kafka_record import KafkaRecord
from compliance_service.infra.messaging.unit_of_work import UnitOfWorkFactory

logger = logging.getLogger(__name__)
_tracer = trace.get_tracer(__name__)
_dead_lettered = metrics.get_meter(__name__).create_counter(
    "compliance.messages.dead_lettered", description="Messages sent to the dead letter topic"
)


class KafkaConsumer(Protocol):
    async def getone(self) -> KafkaRecord: ...

    async def commit(self, offsets: dict[TopicPartition, int]) -> None: ...


class ProductCreatedConsumer:
    def __init__(
        self,
        consumer: KafkaConsumer,
        unit_of_work: UnitOfWorkFactory,
        dead_letter: DeadLetterPublisher,
        *,
        initial_backoff: float = 1.0,
        max_backoff: float = 30.0,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._consumer = consumer
        self._unit_of_work = unit_of_work
        self._dead_letter = dead_letter
        self._initial_backoff = initial_backoff
        self._max_backoff = max_backoff
        self._sleep = sleep

    # Only cancellation stops the loop, so a broker hiccup never silently ends consumption.
    async def run(self) -> None:
        backoff = self._initial_backoff
        while True:
            try:
                await self.process(await self._consumer.getone())
                backoff = self._initial_backoff
            except Exception:
                logger.exception("Consumer loop failed; retrying in %.1fs", backoff)
                await self._sleep(backoff)
                backoff = min(backoff * 2, self._max_backoff)

    # A message that can never succeed goes to the dead letter topic. Anything else is retried in
    # place, so the offset is committed only once the message is handled.
    async def process(self, record: KafkaRecord) -> None:
        backoff = self._initial_backoff
        while True:
            try:
                await self._handle(record)
                break
            except Exception:
                logger.exception("Failed to process %s; retrying in %.1fs", _position(record), backoff)
                await self._sleep(backoff)
                backoff = min(backoff * 2, self._max_backoff)
        try:
            await self._consumer.commit({TopicPartition(record.topic, record.partition): record.offset + 1})
        except (CommitFailedError, IllegalStateError) as err:
            # The partition moved to another member (rebalance, or a retry longer than the poll interval).
            # The new owner gets the record again and the inbox skips it.
            logger.warning("Could not commit %s: %s", _position(record), err)

    async def _handle(self, record: KafkaRecord) -> None:
        carrier = {name: value.decode(errors="replace") for name, value in record.headers if value is not None}
        with _tracer.start_as_current_span(
            f"{record.topic} process",
            context=propagate.extract(carrier),
            kind=trace.SpanKind.CONSUMER,
            attributes={
                "messaging.system": "kafka",
                "messaging.destination.name": record.topic,
                "messaging.kafka.offset": record.offset,
            },
        ):
            try:
                event = read_product_created(record.headers, record.key, record.value)
                async with self._unit_of_work() as unit_of_work:
                    if await unit_of_work.inbox.was_processed(event.event_id):
                        logger.info("Event %s already processed; skipping", event.event_id)
                        return
                    analysis = await unit_of_work.analyze_product.analyze(event.product)
                    await unit_of_work.inbox.mark_processed(event.event_id, event.event_type)
                    await unit_of_work.commit()
                logger.info("Product %s analysed as %s", analysis.sku, analysis.status.value)
            except (UnprocessableMessageError, DomainError) as err:
                logger.warning("Sending %s to the dead letter topic: %s", _position(record), err)
                await self._dead_letter.send(record, str(err))
                _dead_lettered.add(1, {"reason": type(err).__name__})


def _position(record: KafkaRecord) -> str:
    return f"{record.topic}[{record.partition}]@{record.offset}"
