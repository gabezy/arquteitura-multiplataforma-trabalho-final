import asyncio
import json
from contextlib import asynccontextmanager
from datetime import UTC, datetime

import pytest
from aiokafka import TopicPartition
from aiokafka.errors import CommitFailedError, KafkaConnectionError
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from compliance_service.core.product.model.compliance_report import ComplianceReport
from compliance_service.core.product.model.product_analysis import ProductAnalysis
from compliance_service.infra.messaging.dead_letter import DeadLetterPublisher
from compliance_service.infra.messaging.product_created_consumer import ProductCreatedConsumer

NOW = datetime(2026, 10, 15, 12, 0, tzinfo=UTC)


class FakeAnalyzeProduct:
    def __init__(self, failures: int = 0) -> None:
        self.failures = failures
        self.analyzed = []

    async def analyze(self, product):
        if self.failures:
            self.failures -= 1
            raise RuntimeError("database unavailable")
        self.analyzed.append(product)
        return ProductAnalysis.of(product, ComplianceReport(), NOW)


class FakeInbox:
    def __init__(self, processed: set[str], pending: set[str]) -> None:
        self._processed = processed
        self._pending = pending

    async def was_processed(self, event_id):
        return event_id in self._processed

    async def mark_processed(self, event_id, event_type):
        self._pending.add(event_id)


class FakeUnitOfWork:
    def __init__(self, processed: set[str], analyze_product: FakeAnalyzeProduct) -> None:
        self._processed = processed
        self._pending: set[str] = set()
        self.inbox = FakeInbox(processed, self._pending)
        self.analyze_product = analyze_product

    async def commit(self):
        self._processed |= self._pending


class FakeKafkaConsumer:
    def __init__(self, records=(), commit_error: Exception | None = None) -> None:
        self.commits = []
        self._records = list(records)
        self._commit_error = commit_error

    async def getone(self):
        if not self._records:
            raise asyncio.CancelledError
        item = self._records.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    async def commit(self, offsets):
        if self._commit_error:
            error, self._commit_error = self._commit_error, None
            raise error
        self.commits.append(offsets)


class Harness:
    def __init__(
        self,
        producer,
        failures: int = 0,
        processed: set[str] | None = None,
        kafka: FakeKafkaConsumer | None = None,
    ) -> None:
        self.processed = processed if processed is not None else set()
        self.analyze_product = FakeAnalyzeProduct(failures)
        self.kafka = kafka or FakeKafkaConsumer()
        self.producer = producer
        self.sleeps: list[float] = []

        @asynccontextmanager
        async def unit_of_work():
            yield FakeUnitOfWork(self.processed, self.analyze_product)

        async def sleep(seconds):
            self.sleeps.append(seconds)

        self.consumer = ProductCreatedConsumer(
            self.kafka,
            unit_of_work,
            DeadLetterPublisher(producer, "compliance.product-created.dlq"),
            sleep=sleep,
        )


EXPECTED_COMMIT = {TopicPartition("catalog.product.created.v1", 1): 8}


async def test_analyses_a_new_product(producer, make_record):
    harness = Harness(producer)

    await harness.consumer.process(make_record())

    assert [p.sku for p in harness.analyze_product.analyzed] == ["SKU-1"]
    assert harness.processed == {"e-1"}
    assert harness.kafka.commits == [EXPECTED_COMMIT]
    assert producer.sent == []


async def test_skips_an_event_already_processed(producer, make_record):
    harness = Harness(producer, processed={"e-1"})

    await harness.consumer.process(make_record())

    assert harness.analyze_product.analyzed == []
    assert harness.kafka.commits == [EXPECTED_COMMIT]


async def test_sends_an_unprocessable_message_to_the_dead_letter_topic(producer, make_record):
    harness = Harness(producer)

    await harness.consumer.process(make_record(event_type="catalog.product.approved.v1"))

    [message] = producer.sent
    assert message.topic == "compliance.product-created.dlq"
    assert dict(message.headers)["dlq-reason"].startswith(b"Unexpected event type")
    assert harness.analyze_product.analyzed == []
    assert harness.processed == set()
    assert harness.kafka.commits == [EXPECTED_COMMIT]


async def test_sends_a_product_breaking_domain_rules_to_the_dead_letter_topic(producer, make_record):
    harness = Harness(producer)
    value = json.dumps({**json.loads(make_record().value), "price": -1}).encode()

    await harness.consumer.process(make_record(value=value))

    [message] = producer.sent
    assert dict(message.headers)["dlq-reason"] == b"price must not be negative."
    assert harness.kafka.commits == [EXPECTED_COMMIT]


async def test_ignores_headers_without_value(producer, make_record):
    harness = Harness(producer)
    record = make_record()
    record.headers.append(("x-empty", None))

    await harness.consumer.process(record)

    assert harness.processed == {"e-1"}


async def test_retries_a_transient_failure_without_losing_the_message(producer, make_record):
    harness = Harness(producer, failures=1)

    await harness.consumer.process(make_record())

    assert harness.sleeps == [1.0]
    assert len(harness.analyze_product.analyzed) == 1
    assert harness.processed == {"e-1"}
    assert harness.kafka.commits == [EXPECTED_COMMIT]


async def test_backs_off_exponentially_up_to_the_cap(producer, make_record):
    harness = Harness(producer, failures=7)

    await harness.consumer.process(make_record())

    assert harness.sleeps == [1.0, 2.0, 4.0, 8.0, 16.0, 30.0, 30.0]


async def test_survives_an_offset_commit_rejected_after_a_rebalance(producer, make_record):
    harness = Harness(producer, kafka=FakeKafkaConsumer(commit_error=CommitFailedError("rebalanced")))

    await harness.consumer.process(make_record())

    assert harness.processed == {"e-1"}
    assert harness.kafka.commits == []


async def test_keeps_consuming_after_a_broker_error(producer, make_record):
    kafka = FakeKafkaConsumer(records=[KafkaConnectionError("broker down"), make_record()])
    harness = Harness(producer, kafka=kafka)

    with pytest.raises(asyncio.CancelledError):
        await harness.consumer.run()

    assert harness.processed == {"e-1"}
    assert harness.sleeps == [1.0]


@pytest.fixture(scope="module")
def spans():
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    return exporter


async def test_continues_the_trace_from_the_message(spans, producer, make_record):
    await Harness(producer).consumer.process(make_record())

    [span] = [s for s in spans.get_finished_spans() if s.name == "catalog.product.created.v1 process"]
    assert span.kind is trace.SpanKind.CONSUMER
    assert format(span.context.trace_id, "032x") == "0af7651916cd43dd8448eb211c80319c"
    assert format(span.parent.span_id, "016x") == "b7ad6b7169203331"
