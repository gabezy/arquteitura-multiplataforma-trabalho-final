from decimal import Decimal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    port: int = 8083
    log_level: str = "INFO"
    otel_service_name: str = "compliance-service"
    otel_collector_url: str = "http://localhost:4318"
    database_url: str = "postgresql+asyncpg://compliance:compliance@localhost:5433/compliance"
    kafka_brokers: str = "localhost:9092"
    product_created_topic: str = "catalog.product.created.v1"
    produto_analisado_topic: str = "produto.analisado.v1"
    product_created_dlq_topic: str = "compliance.product-created.dlq"
    price_ceiling: Decimal = Decimal("100000")
    description_min_length: int = 20

    @property
    def kafka_bootstrap_servers(self) -> list[str]:
        return [broker.strip() for broker in self.kafka_brokers.split(",") if broker.strip()]
