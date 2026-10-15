from decimal import Decimal

from compliance_service.infra.config.settings import Settings


def test_has_local_defaults(monkeypatch):
    for name in ("DATABASE_URL", "KAFKA_BROKERS", "PRICE_CEILING", "PORT"):
        monkeypatch.delenv(name, raising=False)

    settings = Settings(_env_file=None)

    assert settings.port == 8083
    assert settings.database_url == "postgresql+asyncpg://compliance:compliance@localhost:5433/compliance"
    assert settings.product_created_topic == "catalog.product.created.v1"
    assert settings.produto_analisado_topic == "produto.analisado.v1"
    assert settings.product_created_dlq_topic == "compliance.product-created.dlq"
    assert settings.price_ceiling == Decimal("100000")
    assert settings.description_min_length == 20


def test_reads_environment_variables(monkeypatch):
    monkeypatch.setenv("PRICE_CEILING", "500.50")
    monkeypatch.setenv("KAFKA_BROKERS", "kafka:19092, other:9092")

    settings = Settings(_env_file=None)

    assert settings.price_ceiling == Decimal("500.50")
    assert settings.kafka_bootstrap_servers == ["kafka:19092", "other:9092"]
