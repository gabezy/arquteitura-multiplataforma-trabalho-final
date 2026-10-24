from decimal import Decimal

import pytest
from pydantic import ValidationError

from compliance_service.infra.config.settings import Settings

ENV_VARS = ("DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD", "KAFKA_BROKERS", "PRICE_CEILING", "PORT")


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in ENV_VARS:
        monkeypatch.delenv(name, raising=False)


def test_has_local_defaults():
    settings = Settings(_env_file=None, db_user="compliance", db_password="secret")

    assert settings.port == 8083
    assert settings.database_url == "postgresql+asyncpg://compliance:secret@localhost:5433/compliance"
    assert settings.product_created_topic == "catalog.product.created.v1"
    assert settings.produto_analisado_topic == "produto.analisado.v1"
    assert settings.product_created_dlq_topic == "compliance.product-created.dlq"
    assert settings.price_ceiling == Decimal("100000")
    assert settings.description_min_length == 20


def test_builds_the_database_url_from_the_db_variables(monkeypatch):
    monkeypatch.setenv("DB_HOST", "compliance-db")
    monkeypatch.setenv("DB_PORT", "5432")
    monkeypatch.setenv("DB_NAME", "comp")

    settings = Settings(_env_file=None, db_user="compliance", db_password="secret")

    assert settings.database_url == "postgresql+asyncpg://compliance:secret@compliance-db:5432/comp"


def test_percent_encodes_the_database_password():
    settings = Settings(_env_file=None, db_user="compliance", db_password="p@ss/w:rd")

    assert ":p%40ss%2Fw%3Ard@" in settings.database_url


def test_requires_the_database_credentials():
    with pytest.raises(ValidationError):
        Settings(_env_file=None)


def test_reads_environment_variables(monkeypatch):
    monkeypatch.setenv("PRICE_CEILING", "500.50")
    monkeypatch.setenv("KAFKA_BROKERS", "kafka:19092, other:9092")

    settings = Settings(_env_file=None, db_user="compliance", db_password="secret")

    assert settings.price_ceiling == Decimal("500.50")
    assert settings.kafka_bootstrap_servers == ["kafka:19092", "other:9092"]


def test_a_missing_db_user_does_not_expose_the_password():
    with pytest.raises(ValidationError) as error:
        Settings(_env_file=None, db_password="s3cr3t-pass")

    assert "s3cr3t-pass" not in str(error.value)
