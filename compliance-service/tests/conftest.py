from collections.abc import AsyncIterator, Iterator
from decimal import Decimal
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from testcontainers.community.postgres import PostgresContainer

from compliance_service.core.product.model.product import Product
from compliance_service.infra.persistence.database import create_engine, create_session_factory

SERVICE_ROOT = Path(__file__).resolve().parents[1]


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


@pytest.fixture(scope="session")
def database_url() -> Iterator[str]:
    with PostgresContainer("postgres:18-alpine", driver="asyncpg") as postgres:
        url = postgres.get_connection_url()
        config = Config(str(SERVICE_ROOT / "alembic.ini"))
        config.set_main_option("sqlalchemy.url", url)
        command.upgrade(config, "head")
        yield url


@pytest.fixture
async def engine(database_url) -> AsyncIterator:
    engine = create_engine(database_url)
    yield engine
    async with engine.begin() as connection:
        await connection.execute(text("TRUNCATE product_analyses, processed_events"))
    await engine.dispose()


@pytest.fixture
def session_factory(engine):
    return create_session_factory(engine)
