import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress

import uvicorn
from aiokafka import AIOKafkaConsumer, AIOKafkaProducer
from fastapi import FastAPI
from opentelemetry import metrics

from compliance_service.infra.config.settings import Settings
from compliance_service.infra.http.app import create_app
from compliance_service.infra.messaging.dead_letter import DeadLetterPublisher
from compliance_service.infra.messaging.kafka_analysis_result_publisher import KafkaAnalysisResultPublisher
from compliance_service.infra.messaging.product_created_consumer import ProductCreatedConsumer
from compliance_service.infra.observability.metered_analyze_product import AnalysisInstruments
from compliance_service.infra.observability.telemetry import instrument_app, instrument_engine, setup_telemetry
from compliance_service.infra.persistence.database import create_engine, create_session_factory
from compliance_service.infra.product_factory import build_rules, build_unit_of_work_factory
from compliance_service.infra.system_clock import SystemClock

CONSUMER_GROUP = "compliance-service"

settings = Settings()
telemetry = setup_telemetry(settings)
logger = logging.getLogger(__name__)


def _log_consumer_exit(task: asyncio.Task) -> None:
    if not task.cancelled() and task.exception():
        logger.error("Product consumer stopped", exc_info=task.exception())


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    engine = create_engine(settings.database_url)
    instrument_engine(engine)
    producer = AIOKafkaProducer(bootstrap_servers=settings.kafka_bootstrap_servers, acks="all")
    kafka_consumer = AIOKafkaConsumer(
        settings.product_created_topic,
        bootstrap_servers=settings.kafka_bootstrap_servers,
        group_id=CONSUMER_GROUP,
        enable_auto_commit=False,
        auto_offset_reset="earliest",
    )
    await producer.start()
    await kafka_consumer.start()

    consumer = ProductCreatedConsumer(
        kafka_consumer,
        build_unit_of_work_factory(
            create_session_factory(engine),
            build_rules(settings),
            KafkaAnalysisResultPublisher(producer, settings.produto_analisado_topic),
            SystemClock(),
            AnalysisInstruments.create(metrics.get_meter("compliance_service")),
        ),
        DeadLetterPublisher(producer, settings.product_created_dlq_topic),
    )
    task = asyncio.create_task(consumer.run())
    task.add_done_callback(_log_consumer_exit)
    logger.info("Consuming %s", settings.product_created_topic)

    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
        await kafka_consumer.stop()
        await producer.stop()
        await engine.dispose()
        telemetry.shutdown()


app = create_app(lifespan)
instrument_app(app)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=settings.port)
