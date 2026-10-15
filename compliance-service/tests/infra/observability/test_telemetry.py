import pytest
from opentelemetry.instrumentation.aiokafka import AIOKafkaInstrumentor
from opentelemetry.instrumentation.dependencies import get_dependency_conflicts
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.logging import LoggingInstrumentor
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor


# An instrumentor whose library version is out of range silently instruments nothing.
@pytest.mark.parametrize(
    "instrumentor", [AIOKafkaInstrumentor, FastAPIInstrumentor, LoggingInstrumentor, SQLAlchemyInstrumentor]
)
def test_installed_libraries_are_supported_by_the_instrumentations(instrumentor):
    assert get_dependency_conflicts(instrumentor().instrumentation_dependencies()) is None
